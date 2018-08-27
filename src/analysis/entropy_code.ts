
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';
import * as logger from '../logger';
import {Analysis} from '../analysis';
import {FileStore} from '../file_store';

export class EntropyCodeAnalysis
  extends Analysis
{
    readonly probTableMap: Map<string, ProbTable>;
    readonly identWindowTable: ProbTable;
    readonly propWindowTable: ProbTable;
    readonly stringWindowTable: ProbTable;

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
        const {idents, props, strings} =
            ProbTable.fromStringWindowJson(strWindowJson);

        this.identWindowTable = idents;
        this.propWindowTable = props;
        this.stringWindowTable = strings;
    }

    get name(): string {
        return 'entropy-code';
    }

    endAnalysis() {
    }

    analyzeAst(subpath: string, script: TS.Script)
    {
        const handler = new EntropyCodeHandler(script,
                                this.probTableMap);
        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();

        const {bitsEmitted, symsEmitted} = handler;

        const labels = Array.from(bitsEmitted.keys()).sort(
        (a, b) => {
            return symsEmitted.get(b) - symsEmitted.get(a);
        });

        logger.log("REPORT");
        for (let label of labels) {
            const bits = handler.bitsEmitted.get(label);
            const syms = handler.symsEmitted.get(label);
            const bitsPerSym = (bits / syms);

            const rBits = roundN(bits, 100);
            const rBitsPerSym = roundN(bitsPerSym, 100);

            logger.log(
                `Encoded ${label} - ${syms} symbols` +
                ` in ${rBits} bits =` +
                ` ${rBitsPerSym} bits/symbol`);
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

    constructor(root: S.Instance,
                probTableMap: Map<string, ProbTable>)
    {
        this.root = root;
        this.probTableMap = probTableMap;
        this.symsEmitted = new Map();
        this.bitsEmitted = new Map();
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

        logger.log(`Skip implicit type ${tyStr}`);
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

        logger.log(`Emit type ${tyStr}`);
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
            assert((ty instanceof S.FieldTypeIface) ||
                   (ty instanceof S.FieldTypeIdent) ||
                   (ty === S.FieldTypePrimitive.F64) ||
                   (ty === S.FieldTypePrimitive.Str) ||
                   (ty === S.FieldTypePrimitive.Null),
                "TY=" + ty.prettyString());
            if (! ((ty instanceof S.FieldTypeIface) ||
                   (ty === S.FieldTypePrimitive.Null)))
            {
                logger.log(`TODO: Emit ${tyStr} value`);
            }
            return;
        }

        const [tag, index, alpha] = valtag;
        const pathStr = `${suffix.keyString()}#${tag}`;

        const probTable = this.probTableMap.get(pathStr);
        assert(probTable);

        logger.log(`Emit value ${tyStr}`);
        this.encodeWith(probTable, index, ['value', tyStr]);
    }

    private encodeWith(probTable: ProbTable,
                       index: number,
                       name: Array<string>)
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

        logger.log(`    pct=${pct}% bits=${rbits}`);

        this.noteEmittedSym(name, bits);
        logger.log(``);
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
            const newProb = (oldProb * scale)>>>0;
            if (oldProb > 0) {
                assert(newProb > 0, "Probability too fine!");
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

        // Order by priority.
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
