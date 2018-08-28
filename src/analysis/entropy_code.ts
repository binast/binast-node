
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';
import * as logger from '../logger';
import {Analysis} from '../analysis';
import {FileStore} from '../file_store';
import {StringCache} from '../string_cache';
import {brotliBytes} from '../the_competition';
import {jsStringToWtf8Bytes} from '../wtf8';

export class EntropyCodeAnalysis
  extends Analysis
{
    readonly probTableMap: Map<string, ProbTable>;

    readonly globalStrings: Map<string, number>;
    readonly identModel: StringModel;
    readonly propModel: StringModel;
    readonly rawModel: StringModel;

    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        super(schema, scriptStore, resultStore, opts);

        const suffixJson = resultStore.readJSON(
                        "path-suffix/2/ALL.json");
        this.probTableMap =
            ProbTable.fromSuffixArrayJson(suffixJson);

        const strWindowJson = resultStore.readJSON(
                        "string-window/64/ALL.json");

        const globalStringsJson = resultStore.readJSON(
                        "global-strings/ALL.json");
        assert(globalStringsJson instanceof Array);
        this.globalStrings = new Map<string, number>(
            globalStringsJson.slice(0, 4096).map((e,i) => {
                assert(typeof(e['str']) == 'string');
                return [e['str'] as string, i];
            }));

        const {idents, props, strings} =
            ProbTable.fromStringWindowJson(strWindowJson);

        this.identModel = new StringModel('ident', idents,
                new StringCache(idents.numEntries - 1));

        this.propModel = new StringModel('prop', props,
                new StringCache(props.numEntries - 1));

        this.rawModel = new StringModel('raw', strings,
                new StringCache(strings.numEntries - 1));
    }

    get name(): string {
        return 'entropy-code';
    }

    endAnalysis() {
    }

    analyzeAst(subpath: string, script: TS.Script)
    {
        const fileSize =
            this.scriptStore.sizeOfFile(subpath);

        const handler = new EntropyCodeHandler(
                                        script, this);
        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();

        const {bitsEmitted, symsEmitted, stringTable} =
            handler;

        const labels = Array.from(bitsEmitted.keys()).sort(
        (a, b) => {
            return bitsEmitted.get(b) - bitsEmitted.get(a);
        });

        const gzipData =
            this.scriptStore.readCompressedBytes(
                                        subpath, 'gzip');
        const brotliData =
            this.scriptStore.readCompressedBytes(
                                        subpath, 'brotli');

        const brotliStringsSize =
            brotliBytes(stringTable.encodedData()).length;

        logger.log(`REPORT ${fileSize} - ${subpath}`);
        logger.log(`    StringTable ${stringTable.numEntries} entries of size ${stringTable.totalSize} -- brotli ${brotliStringsSize}`);

        const totalBits = handler.bitsEmitted.get('sym');
        const totalBytes = ((totalBits / 8)>>>0) + 1;
        const estimatedAllBytes = totalBytes + brotliStringsSize;

        const gzipBetter =
            roundN(totalBytes / gzipData.length, 10000);
        const brotliBetter =
            roundN(totalBytes / brotliData.length, 10000);

        logger.log(`   [BinAST=${totalBytes} --> ${estimatedAllBytes}]` +
                   ` [gzip=${gzipData.length} // ${gzipBetter}]` +
                   ` [brotli=${brotliData.length} // ${brotliBetter}]`);

        for (let label of labels) {
            if (label.replace(/[^\/]/g, '').length > 1) {
                continue;
            }
            const bits = handler.bitsEmitted.get(label);
            const syms = handler.symsEmitted.get(label);
            const bitsPerSym = (bits / syms);

            const rBits = roundN(bits, 100);
            const rBitsPerSym = roundN(bitsPerSym, 100);

            logger.log(
                `Encoded ${label} - ${syms} symbols` +
                ` in ${rBits} bits`);
            logger.log(` ${rBitsPerSym} bits/symbol`);
        }
    }
}

const SUFFIX_LENGTH: number = 2;

class EntropyCodeHandler
  implements S.VisitHandler
{
    readonly root: S.Instance;
    readonly probTableMap: Map<string, ProbTable>;
    readonly symsEmitted: Map<string, number>;
    readonly bitsEmitted: Map<string, number>;
    readonly identModel: StringModel;
    readonly propModel: StringModel;
    readonly rawModel: StringModel;
    readonly globalStrings: Map<string, number>;
    readonly stringTable: StringTable;

    constructor(root: S.Instance,
                analysis: EntropyCodeAnalysis)
    {
        this.root = root;
        this.probTableMap = analysis.probTableMap;
        this.symsEmitted = new Map();
        this.bitsEmitted = new Map();

        this.identModel = analysis.identModel;
        this.propModel = analysis.propModel;
        this.rawModel = analysis.rawModel;
        this.globalStrings = analysis.globalStrings;
        this.stringTable = new StringTable();
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        // logger.log(`BEGIN ${shape.ty.prettyString()} ${key}`);

        // Try to find a match from longest path suffix to
        // shortest.
        let matched: S.PathSuffix|null = null;
        for (let i = SUFFIX_LENGTH; i >= 1; i--) {
            const suffix = S.PathSuffix.forLocation(
                                schema, loc, i);
            if (suffix !== null) {
                matched = suffix;
                break;
            }
        }

        if (!matched) {
            assert(value === this.root);
            return;
        }

        this.emit(schema, loc, matched);
    }
    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }

    private emit(schema: S.TreeSchema,
                 loc: S.TreeLocation,
                 suffix: S.PathSuffix)
    {
        const {shape, value} = loc;
        const tySet = shape.typeSet;
        assert(tySet.tys.length > 0);

        // Emit the type tag.
        this.emitType(schema, loc, suffix, tySet);

        // Emit the value tag, if needed.
        this.emitValue(schema, loc, suffix,
                       shape, value);
    }

    private emitType(schema: S.TreeSchema,
                     loc: S.TreeLocation,
                     suffix: S.PathSuffix,
                     tySet: S.TypeSet)
    {
        const {shape} = loc;
        const {typeSet, ty} = shape;
        const tyStr = ty.prettyString();

        //logger.log(`Skip implicit type ${tyStr}`);
        if (typeSet.tys.length == 1) {
            // Trivially skip encodings for types coming
            // from a singleton typeset.
            return;
        }

        assert(typeSet.tys.length > 1);

        const suffixKey = suffix.keyString();
        const pathKey = `${suffixKey}#type`;
        const probTable = this.probTableMap.get(pathKey);
        assert(probTable, "Failed to get ProbTable.");

        //logger.log(`Emit type ${tyStr}`);
        this.encodeWith(probTable, shape.index,
                        ['type', tyStr]);
    }

    private emitValue(schema: S.TreeSchema,
                     loc: S.TreeLocation,
                     suffix: S.PathSuffix,
                     shape: S.PathShape,
                     value: S.Value)
    {
        // Get the suffix tag for the given value.
        const ty = shape.ty;
        const tyStr = ty.prettyString();

        const valtag = suffix.valueTagAndIndex(
                                    schema, ty, value);
        if (valtag === null) {
            // No value to encode, either an iface or
            // an identifier.

            if (ty instanceof S.FieldTypeIdent) {
                assert(value instanceof S.Identifier);
                const valueStr =
                    (value as S.Identifier).name;

                if (ty.tag === 'ident') {
                    this.emitStringRef(
                        this.identModel, valueStr);
                } else if (ty.tag === 'prop') {
                    this.emitStringRef(
                        this.propModel, valueStr);
                } else {
                    throw new Error(`Unknon ident tag ` +
                                    ty.tag);
                }
                return;
            }

            if (ty === S.FieldTypePrimitive.Str) {
                this.emitStringRef(this.rawModel,
                                   value as string);
                return;
            }

            if (ty === S.FieldTypePrimitive.F64) {
                this.emitF64(value as number);
                return;
            }

            // Don't need to handle either of these.
            // Ifaces will have their structure walked,
            // and Nulls don't have any value to encode.
            assert((ty instanceof S.FieldTypeIface) ||
                   (ty === S.FieldTypePrimitive.Null),
                "TY=" + ty.prettyString());
            return;
        }

        const [tag, index, alpha] = valtag;
        const pathStr = `${suffix.keyString()}#${tag}`;

        const probTable = this.probTableMap.get(pathStr);
        assert(probTable);

        //logger.log(`Emit value ${tyStr}`);
        this.encodeWith(probTable, index, ['value', tyStr]);
    }

    private emitStringRef(model: StringModel, val: string) {
        const {cache, table} = model;

        const lookup = cache.lookup(val);
        assert(lookup < (table.numEntries - 1));
        const idx = (lookup < 0) ? table.numEntries - 1
                                 : lookup;
        // logger.log(`Emit string ${lookup} -` +
        //            ` ${model.kind}`);
        this.encodeWith(table, idx, ['string', model.kind]);

        // Handle a miss by emitting a raw string ref.
        if (lookup < 0) {
            this.emitRawStringRef(model, val);
        }
    }

    private emitRawStringRef(model: StringModel,
                             val: string)
    {
        let idx: number = 0;
        if (this.globalStrings.has(val)) {
            idx = this.globalStrings.get(val);
        } else {
            idx = this.stringTable.indexOf(val) +
                    this.globalStrings.size;
        }
        const {kind} = model;
        
        // logger.log(`Emit escape string ${idx}` +
        //            ` - ${kind}`);
        this.encodeVarUint(idx, ['string', 'escape', kind]);
    }

    private emitF64(val: number) {
        assert(typeof(val) === 'number');
        // logger.log(`Emit escape f64`);
        this.encodeRaw64(val, ['value', 'f64']);
    }

    private encodeWith(probTable: ProbTable,
                       index: number,
                       category: Array<string>)
    {
        const offsetSizeTotal =
            probTable.getOffsetSizeTotal(index);
        assert(offsetSizeTotal);
        const [offset, size, total] = offsetSizeTotal;

        // TODO: Handle size === 0 by encoding an escape
        // followed by literal symbol code.
        assert(size > 0);

        const prob = size / total;
        const pct = roundN(prob * 100);
        const bits = Math.log(1/prob) / Math.log(2);
        const rbits = roundN(bits, 1000 * 1000 * 1000);

        // logger.log(`    pct=${pct}% bits=${rbits}`);
        this.noteEmittedSym(category, bits);
        // logger.log(``);
    }

    private encodeRaw64(value: number,
                        category: Array<string>)
    {
        // logger.log(`    raw64 bits=64`);
        this.noteEmittedSym(category, 64);
        // logger.log(``);
    }

    private encodeVarUint(value: number,
                          category: Array<string>)
    {
        let bits: number = 0;
        if (value < 0x80) { // 7 bits
            bits = 8;
        } else if (value < 0x4000) { // 14 bits
            bits = 16;
        } else if (value < 0x20000) { // 21 bits.
            bits = 24;
        } else if (value < 0x10000000) { // 28 bits.
            bits = 28;
        } else {
            throw new Error('Unhandled uint size');
        }

        // logger.log(`    varuint bits=${bits}`);
        this.noteEmittedSym(category, bits);
        // logger.log(``);
    }

    private noteEmittedSym(name: Array<string>,
                           bits: number)
    {
        name.unshift('sym');
        for (let i = 1; i <= name.length; i++) {
            const prefixStr = name.slice(0, i).join('/');
            incrMapEntry(this.bitsEmitted, prefixStr, bits);
            incrMapEntry(this.symsEmitted, prefixStr, 1);
        }
    }
}

function roundN(n: number, k: number = 100): number {
    return Math.floor(n * k) / k;
}

function incrMapEntry(s: Map<string, number>, key: string,
                      incr: number)
  : number
{
    let num = s.get(key);
    if (typeof(num) !== 'number') {
        num = 0;
    }
    const newNum = num + incr;
    // logger.log(`MAP ${key} ::: ${num} + ${incr} => ${newNum}`);
    s.set(key, newNum);
    return newNum;
}

class StringTable {
    readonly strings: Array<string>;
    readonly indexMap: Map<string, number>;

    constructor() {
        this.strings = [];
        this.indexMap = new Map();
    }

    indexOf(str: string): number {
        let idx: number = this.indexMap.get(str);
        if (typeof(idx) === 'number') {
            return idx;
        }
        idx = this.strings.length;
        this.strings.push(str);
        this.indexMap.set(str, idx);
        return idx;
    }

    get numEntries(): number {
        return this.strings.length;
    }

    get totalSize(): number {
        let size: number = 0;
        for (let s of this.strings) {
            size += s.length;
            if (s.length < (1 << 7)) {
                size += 1;
            } else if (s.length < (1 << 14)) {
                size += 2;
            } else if (s.length < (1 << 21)) {
                size += 3;
            } else if (s.length < (1 << 28)) {
                size += 4;
            } else {
                throw new Error(
                    "Don't put >256-meg long literal " +
                    "strings in your code.");
            }
        }
        return size;
    }

    encodedData(): Uint8Array {
        const b = new Array<number>();
        for (let s of this.strings) {
            for (let n of jsStringToWtf8Bytes(s)) {
                b.push(n);
            }
        }
        b.push(("\n").charCodeAt(0));
        return new Uint8Array(b);
    }
}

class StringModel {
    readonly kind: string;
    readonly table: ProbTable;
    readonly cache: StringCache;

    constructor(kind: string,
                table: ProbTable,
                cache: StringCache)
    {
        this.kind = kind;
        this.table = table;
        this.cache = cache;
        Object.freeze(this);
    }
}

/**
 * A ProbTable represents an integer series of codings.
 * It is a probability space over a range of indices
 * `[0, N-1]`.  Each probability is recorded as a UInt32,
 * summing to a maximum of 2^18.
 *
 * In reality, the sum is engineered to be 2^18, and then
 * if needed, a space of size 1/2^18 is added for unknown
 * entries (escape hatch for raw-coded entries).
 */
const PROB_TABLE_SUM_BITS: number = 18;
const PROB_TABLE_SUM: number = (1 << PROB_TABLE_SUM_BITS);

class ProbTable {
    // Key to this prob table.
    readonly key: string;

    // names for each prob.
    readonly names: Array<string|number>;

    // Non-normalized frequencies as provided.
    readonly probs: Uint32Array;

    // For quick lookup, accumulation of probs.
    readonly probAccum: Uint32Array;

    // Sum of all probabilities (last entry of probAccum)
    readonly probSum: number;

    // Whether to allow an escape or not.
    readonly allowEscape: boolean;

    constructor(key: string,
                names: Array<string|number>,
                probs: Uint32Array)
    {
        assert(names.length === probs.length);

        this.key = key;
        this.names = names;
        this.probs = probs;
        this.probAccum = new Uint32Array(probs.length);
        this.allowEscape = (probs.indexOf(0) >= 0);

        this.normalizeProbs();

        this.probSum =
            this.probAccum[this.probAccum.length - 1] +
                (this.allowEscape ? 1 : 0);
    }

    normalizeProbs() {
        const numEntries = this.probs.length;

        // Compute the sum.
        let sum: number = 0;
        for (let prob of this.probs) {
            sum += prob;
        }

        // Scale to PROB_TABLE_SUM, except if escape is
        // needed in which case allow 1 element for that.
        const table_sum =
            PROB_TABLE_SUM - (this.allowEscape ? 1 : 0);

        const scale = table_sum / sum;

        // Scale all probs to sum to table_sum
        let total: number = 0;
        for (let i = 0; i < this.probs.length; i++) {
            const oldProb = this.probs[i];
            let newProb = (oldProb * scale)>>>0;
            if ((oldProb > 0) && (newProb == 0)) {
                // assert(newProb > 0, "Probability too fine!");
                newProb = 1;
            }
            total += newProb;
            this.probAccum[i] = total;
        }
    }

    get numEntries(): number {
        return this.probs.length;
    }
    offsetOf(idx: number): number {
        assert(idx < this.numEntries);
        return (idx == 0) ? 0 : this.probAccum[idx-1];
    }
    sizeOf(idx: number): number {
        assert(idx < this.numEntries);
        return this.probAccum[idx] - this.offsetOf(idx);
    }
    getOffsetSizeTotal(idx: number)
      : [number, number, number]
    {
        return [this.offsetOf(idx), this.sizeOf(idx),
                this.probSum];
    }

    static fromSuffixArrayJson(json: any)
      : Map<string, ProbTable>
    {
        const result = new Map<string, ProbTable>();
        assert(json instanceof Array);
        for (let entryJson of json) {
            const probTable =
                ProbTable.fromSuffixJson(entryJson);
            // logger.log("ADDED: `" + probTable.key + "`");
            result.set(probTable.key, probTable);
        }
        return result;
    }

    private static fromSuffixJson(json: any): ProbTable {
        assert(json instanceof Object);
        assert(typeof(json['suffix']) === 'string');
        const key = json['suffix'] as string;

        assert(json['freqs'] instanceof Array);

        const freqs = json['freqs'] as Array<any>;
        for (let freq of freqs) {
            assert((typeof(freq['name']) === 'string') ||
                   (typeof(freq['name']) === 'number'));
            assert(typeof(freq['index']) === 'number');
            assert(typeof(freq['hits']) === 'number');
        }

        // Order by index.
        freqs.sort((a, b) => (a.index - b.index));

        const probs = new Uint32Array(
            freqs.map(f => f.hits as number));
        const names = freqs.map(
            f => f.name as (string|number));

        return new ProbTable(key, names, probs);
    }

    static fromStringWindowJson(json: any)
      : { idents: ProbTable,
          props: ProbTable,
          strings: ProbTable }
    {
        assert(typeof(json.windowSize) === 'number');
        const windowSize = json.windowSize as number;

        const _lift = (key: string, val: any) => {
            assert(val instanceof Array);

            const arr = val as Array<any>;
            assert(arr.length === windowSize + 3);

            const indexArr =
                new Array<[number, number]>();
            let misses: number = -1;
            for (let v of arr) {
                if (typeof(v.index) === 'number') {
                    assert(typeof(v.count) === 'number');
                    indexArr.push([v.index as number,
                                   v.count as number]);
                } else if (v.index === 'MISSES') {
                    misses = v.count;
                }
            }
            indexArr.sort((a, b) => (a[0] - b[0]));
            assert(misses >= 0);

            indexArr.push([-1, misses] as [number, number]);

            const probArray = indexArr.map(ia => ia[1]) as
                                        Array<number>;
            const probs = new Uint32Array(probArray);

            const names = indexArr.map(ia => ia[0]) as
                                    Array<string|number>;
            names[names.length - 1] = 'MISSES';

            return new ProbTable(key, names, probs);
        };

        return {
            idents: _lift('idents', json.idents),
            props: _lift('props', json.idents),
            strings: _lift('strings', json.strings)
        };
    }
}
