
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import * as logger from '../logger';
import {Analysis} from '../analysis';
import {FileStore} from '../file_store';

/**
 * PathSuffixAnalysis analyzes the frequencies
 * of various symbol species that occur at various
 * contexts keyed by the suffixes of the path
 * leading to the symbol.
 */

export type Sym = number | string;

abstract class Alphabet {
    readonly size: number;

    protected constructor(size: number) {
        assert(Number.isInteger(size) && (size > 0));
        this.size = size;
    }

    abstract names(): Iterator<[number, Sym]>;
}

class NamedAlphabet extends Alphabet {
    readonly alphas: ReadonlyArray<Sym>;

    constructor(alphas: ReadonlyArray<Sym>) {
        super(alphas.length);
        this.alphas = alphas;
        Object.freeze(alphas);
        Object.freeze(this);
    }

    names(): Iterator<[number, Sym]> {
        return this.alphas.entries();
    }
}
class NumberedAlphabet extends Alphabet {
    constructor(size: number) {
        super(size);
    }

    names(): Iterator<[number, Sym]> {
        const size = this.size;
        let i = 0;
        return {
            next(): IteratorResult<[number, Sym]> {
                if (i < size) {
                    return {value: [i, i], done:false};
                } else {
                    return {value: undefined, done:true};
                }
            }
        };
    }
}

abstract class FreqCounter {
    totalHits: number;

    constructor() {
        this.totalHits = 0;
    }

    recordHit(idx: number) {
        this.totalHits++;
        this.recordHitImpl(idx);
    }
    abstract hitCount(idx: number): number;

    protected abstract recordHitImpl(idx: number);
}

class SparseFreqCounter extends FreqCounter {
    readonly freqs: Map<number, number>;

    constructor() {
        super();
        this.freqs = new Map();
    }

    hitCount(idx: number): number {
        return this.freqs.get(idx) || 0;
    }

    recordHitImpl(idx: number) {
        this.freqs.set(idx, (this.freqs.get(idx) || 0) + 1);
    }
}

class DenseFreqCounter extends FreqCounter {
    readonly freqs: Uint32Array;

    constructor(limit: number) {
        super();
        this.freqs = new Uint32Array(limit);
    }

    hitCount(idx: number): number {
        return this.freqs[idx];
    }

    recordHitImpl(idx: number) {
        this.freqs[idx]++;
    }
}

class FreqTable {
    readonly alphabet: Alphabet;
    readonly counter: FreqCounter;

    constructor(alphabet: Alphabet) {
        this.alphabet = alphabet;
        this.counter =
            FreqTable.makeFreqCounter(alphabet.size);
        Object.freeze(this);
    }

    recordHit(idx: number) {
        assert(idx < this.alphabet.size);
        this.counter.recordHit(idx);
    }

    get totalHits(): number {
        return this.counter.totalHits;
    }
    
    static makeFreqCounter(size: number): FreqCounter {
        return (size <= 256) ? new DenseFreqCounter(size)
                             : new SparseFreqCounter();
    }

    summarizeFreqs(): Array<HitResult> {
        let result: Array<HitResult> = [];
        let namesIter = this.alphabet.names();
        for (let next = namesIter.next();
             !next.done;
             next = namesIter.next())
        {
            const [index, name] = next.value;
            const hits = this.counter.hitCount(index);
            result.push({name, index, hits});
        }
        result.sort((a, b) => {
            return b.hits - a.hits;
        });
        result.unshift({
            name: 'ALL',
            index: -1,
            hits: this.totalHits
        });
        return result;
    }
}

/**
 * PathSlice represents a slice of a path from
 * the root to a given entry in the tree.  A slice
 * consists of a sequence:
 *
 *      NodeIfaceType, Sym, Sym, ...
 *
 * This specifies a path from a given node type
 * to a field value within it, without crossing
 * into any other AST nodes.
 */
const PATH_SLICES: Map<string, PathSlice> = new Map();
class PathSlice {
    readonly iface: S.Iface;
    readonly subscript: ReadonlyArray<Sym>;

    private constructor(iface: S.Iface,
                        subscript: ReadonlyArray<Sym>)
    {
        this.iface = iface;
        this.subscript = subscript;
        Object.freeze(this.subscript);
        Object.freeze(this);
    }

    keyString(): string {
        return PathSlice.makeKey(this.iface,
                                 this.subscript);
    }

    static make(iface: S.Iface,
                subscript: ReadonlyArray<Sym>)
      : PathSlice
    {
        const key = PathSlice.makeKey(iface, subscript);
        if (! PATH_SLICES.has(key)) {
            const slice = new PathSlice(iface, subscript);
            PATH_SLICES.set(key, slice);
            return slice;
        }
        return PATH_SLICES.get(key);
    }

    static makeKey(iface: S.Iface,
                   subscript: ReadonlyArray<Sym>)
      : string
    {
        const ifaceName = iface.name.name;
        return `${ifaceName}.${subscript.join('.')}`;
    }
}

/**
 * PathSuffix is an array of path slices.
 * the root to a given entry in the tree.  A slice
 * consists of a sequence:
 *
 *      NodeIfaceType, Sym, Sym, ...
 *
 * This specifies a path from a given node type
 * to a field value within it, without crossing
 * into any other AST nodes.
 */
const PATH_SUFFIXES: Map<string, PathSuffix> = new Map();
class PathSuffix {
    readonly slices: ReadonlyArray<PathSlice|null>;

    private constructor(
        slices: ReadonlyArray<PathSlice|null>)
    {
        this.slices = slices;
        Object.freeze(this.slices);
        Object.freeze(this);
    }

    static make(slices: ReadonlyArray<PathSlice|null>)
      : PathSuffix
    {
        const key = PathSuffix.makeKey(slices);
        if (! PATH_SUFFIXES.has(key)) {
            const suffix = new PathSuffix(slices);
            PATH_SUFFIXES.set(key, suffix);
            return suffix;
        }
        return PATH_SUFFIXES.get(key);
    }

    static forLocation(schema: S.TreeSchema,
                       loc: S.TreeLocation,
                       length: number)
      : PathSuffix|null
    {
        assert(Number.isInteger(length) && (length > 0));
        const sliceAccum: Array<PathSlice|null> = [];

        const iter = loc.ancestors();

        if ((typeof(iter.key) === 'number') &&
            (iter.key > 4))
        {
            return null;
        };

        // Start off with the key for the current symbol.
        let symAccum: Array<Sym> = [iter.key];

        // Skip the symbol being visited.
        iter.next();

        for (/**/; !iter.done; iter.next()) {
            if (sliceAccum.length == length) {
                break;
            }
            const key = iter.key;

            // Number keys are only ever array indices.
            // Generalize through them (don't use them
            // for predictive specificity in paths except
            // at the leaves).
            if (typeof(key) === 'number') {
                return null;
            }

            const shape = iter.shape;
            const shapeTy = shape.ty;


            if (! (shapeTy instanceof S.FieldTypeIface)) {
                symAccum.push(key);
                continue;
            }
            // Get the iface and check for node flag.
            const decl = schema.getDecl(shapeTy.name);
            assert(decl instanceof S.Iface);
            const iface = decl as S.Iface;

            if ((iface as S.Iface).isNode) {
                // Arrived at a piece.  Push it.
                const syms = symAccum.reverse();
                symAccum = [iter.key];

                Object.freeze(syms);
                sliceAccum.push(
                    PathSlice.make(iface, syms));
            } else {
                symAccum.push(iter.key);
            }
        }

        // Must be at a whole number of pieces when
        // we stop.
        assert(symAccum.length == 1);
        while (sliceAccum.length < length) {
            sliceAccum.push(null);
        }
        Object.freeze(sliceAccum.reverse());
        return PathSuffix.make(sliceAccum);
    }
                            

    keyString(): string {
        return PathSuffix.makeKey(this.slices);
    }

    static makeKey(slices: ReadonlyArray<PathSlice|null>)
      : string
    {
        return slices.map((v:PathSlice|null) => {
            return (v === null)
                ? '!'
                : v.keyString();
        }).join('/');
    }
}

const DEFAULT_PATH_SUFFIX_LENGTH: number = 1;
const MAX_PATH_SUFFIX_LENGTH: number = 3;

export class PathSuffixAnalysis
  extends Analysis
{
    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        super(schema, scriptStore, resultStore, opts);
    }

    get name(): string {
        return 'path-suffix';
    }

    getSuffixLength(): number {
        if (! ('path-suffix-length' in this.opts)) {
            return DEFAULT_PATH_SUFFIX_LENGTH;
        }
        const lengthStr = this.opts['path-suffix-length'];
        const length = Number.parseInt(lengthStr);
        assert(length >= 0);
        assert(length <= MAX_PATH_SUFFIX_LENGTH,
           `Length ${length} >= ${MAX_PATH_SUFFIX_LENGTH}`);
        return length;
    }

    endAnalysis() {
    }

    analyzeAst(subpath: string, script: TS.Script)
    {
        const suffixLength = this.getSuffixLength();
        const handler = new PathSuffixHandler(suffixLength);

        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();

        const results = handler.summarizeFreqs();
        assert(subpath.match(/\.js$/));

        const genpath = (rep:string) => {
            return this.dataPath(`${suffixLength}/` +
                        subpath.replace(/\.js$/, rep));
        };
        const jsonpath = genpath('.json');

        this.resultStore.writeJSON(jsonpath, results);
    }
}

export type HitResult = {
    name: Sym,
    index: number,
    hits: number
};
export type FreqResult = {
    suffix: string,
    totalHits: number,
    freqs: Array<HitResult>
};

export class PathSuffixHandler
  implements S.VisitHandler
{
    readonly suffixLength: number;
    readonly suffixFreqMap: Map<string, FreqTable>;
    readonly alphabetCache: Map<S.PathShape, Alphabet>;
    readonly valueAlphabetCache:
        Map<string, Alphabet>;

    constructor(suffixLength: number) {
        this.suffixLength = suffixLength;
        this.suffixFreqMap = new Map();
        this.alphabetCache = new Map();
        this.valueAlphabetCache = new Map();
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        const suffix = PathSuffix.forLocation(
                            schema, loc, this.suffixLength);
        if (suffix === null) {
            return;
        }

        const suffixStr = suffix.keyString();
        const shapeStr = shape.prettyString();
        // logger.log(`KVKV Suffix ${suffixStr} => ${shapeStr}`);

        const freqs = this.getFreqs(schema, shape, suffix,
                                    'type');
        if (freqs !== null) {
            freqs.recordHit(shape.index);
        }

        const valFreqs = this.getValueFreqs(
            schema, shape, suffix);
        if (valFreqs !== null) {
            this.recordValueHit(
                schema, shape.ty, value, valFreqs);
        }
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }

    summarizeFreqs(): Array<FreqResult> {
        // Sort the suffixes by freqTable totals,
        // largest to smallest.
        const taggedSuffixes =
            Array.from(this.suffixFreqMap.keys())
                .sort((a, b) => {
                    const ax = this.suffixFreqMap.get(a);
                    const bx = this.suffixFreqMap.get(b);
                    return bx.totalHits - ax.totalHits;
                });
        const result: Array<FreqResult> = [];
        for (let suffix of taggedSuffixes) {
            const ftable = this.suffixFreqMap.get(suffix);
            result.push({
                suffix: suffix,
                totalHits: ftable.totalHits,
                freqs: ftable.summarizeFreqs()
            });
        }
        return result;
    }

    private getFreqs(schema: S.TreeSchema,
                     shape: S.PathShape,
                     suffix: PathSuffix,
                     tag: string)
      : FreqTable|null
    {
        const suffixStr = suffix.keyString();
        const suffixTag = `${suffixStr}#${tag}`;
        const existing = this.suffixFreqMap.get(suffixTag);
        if (existing) {
            return existing;
        }
        const alphabet = this.getAlphabet(schema, shape);
        if (alphabet.size === 1) {
            return null;
        }
        const freqTable = new FreqTable(alphabet);
        this.suffixFreqMap.set(suffixTag, freqTable);
        return freqTable;
    }

    private getAlphabet(schema: S.TreeSchema,
                        shape: S.PathShape)
      : Alphabet
    {
        const existing = this.alphabetCache.get(shape);
        if (existing) {
            return existing;
        }
        const symbols = shape.typeSet.tys.map(ty => {
            return ty.prettyString();
        });
        const created = new NamedAlphabet(symbols);
        this.alphabetCache.set(shape, created);
        return created;
    }

    private getValueFreqs(schema: S.TreeSchema,
                          shape: S.PathShape,
                          suffix: PathSuffix)
      : FreqTable|null
    {
        const suffixStr = suffix.keyString();
        const tag = this.getValueAlphabetKey(schema,
                                             shape.ty);
        if (tag === null) {
            return null;
        }
        const suffixTag = `${suffixStr}#${tag}`;

        const existing = this.suffixFreqMap.get(suffixTag);
        if (existing) {
            return existing;
        }

        const alphabet =
            this.getValueAlphabet(schema, shape.ty);
        if (alphabet === null) {
            return;
        }
        const freqTable = new FreqTable(alphabet);
        this.suffixFreqMap.set(suffixTag, freqTable);
        return freqTable;
    }

    private recordValueHit(schema: S.TreeSchema,
                           ty: S.TerminalFieldType,
                           value: S.Value,
                           freqs: FreqTable)
    {
        const alphaSize = freqs.alphabet.size;
        if (ty instanceof S.FieldTypePrimitive) {
            switch (ty) {
              case S.FieldTypePrimitive.Bool:
                assert(typeof(value) == 'boolean');
                freqs.recordHit(value ? 1 : 0);
                break;
              case S.FieldTypePrimitive.Uint:
                assert(typeof(value) == 'number');
                if (value < alphaSize - 1) {
                    freqs.recordHit(value as number);
                } else {
                    freqs.recordHit(alphaSize - 1);
                }
                break;
              case S.FieldTypePrimitive.Int:
                assert(typeof(value) == 'number');
                const num = value as number;
                if ((num >= -1) && (num < (alphaSize - 2)))
                {
                    freqs.recordHit((num + 1) as number);
                } else {
                    freqs.recordHit(alphaSize - 1);
                }
                break;
              default:
                throw new Error('Bad primitive type.');
            }
        } else if (ty instanceof S.FieldTypeArray) {
            assert(value instanceof Array);
            let len = (value as Array<any>).length;
            if (len < (alphaSize - 1)) {
                freqs.recordHit(len);
            } else {
                freqs.recordHit(alphaSize - 1);
            }
        } else if (ty instanceof S.FieldTypeEnum) {
            assert(typeof(value) === 'string');
            const en = schema.getDecl(ty.name) as S.Enum;
            assert(en instanceof S.Enum);
            const idx = en.indexOfName(value as string);
            freqs.recordHit(idx);
        } else {
            throw new Error('Bad terminal field type.');
        }
    }

    private getValueAlphabet(schema: S.TreeSchema,
                             ty: S.TerminalFieldType)
      : Alphabet|null
    {
        let key: string|null =
            this.getValueAlphabetKey(schema, ty);
        if (key === null) {
            return null;
        }
        const existing = this.valueAlphabetCache.get(key);
        if (existing) {
            return existing;
        }

        let alphaValues: Array<Sym>;
        if (ty instanceof S.FieldTypePrimitive) {
            switch (ty) {
              case S.FieldTypePrimitive.Bool:
                alphaValues = ['true', 'false'];
                break;
              case S.FieldTypePrimitive.Uint:
                alphaValues = [0, 1, 2, 3, 4, 5, 6, 7,
                               'MISS'];
                break;
              case S.FieldTypePrimitive.Int:
                alphaValues = [-1, 0, 1, 2, 3, 4, 5, 6,
                               'MISS'];
                break;
              default:
                throw new Error('Bad primitive type.');
            }
        } else if (ty instanceof S.FieldTypeArray) {
            const arr = new Array<Sym>();
            for (let i = 0; i < 16; i++) { arr.push(i); }
            arr.push('MISS');
            alphaValues = arr;
        } else if (ty instanceof S.FieldTypeEnum) {
            let decl = schema.getDecl(ty.name) as S.Enum;
            assert(decl instanceof S.Enum);
            let en = decl as S.Enum;
            alphaValues = en.variants.map(v => {
                return v.name.fullName;
            });
        } else {
            throw new Error('Bad terminal field type.');
        }

        assert(alphaValues.length > 1);
        const created = new NamedAlphabet(alphaValues);
        this.valueAlphabetCache.set(key, created);
        return created;
    }

    private getValueAlphabetKey(schema: S.TreeSchema,
                                ty: S.TerminalFieldType)
      : string|null
    {
        if (ty instanceof S.FieldTypePrimitive) {
            switch (ty) {
              case S.FieldTypePrimitive.Null:
              case S.FieldTypePrimitive.F64:
              case S.FieldTypePrimitive.Str:
                // Single-entry, no value.
                return null;
              case S.FieldTypePrimitive.Bool:
                return 'bool';
              case S.FieldTypePrimitive.Uint:
                return 'uint';
              case S.FieldTypePrimitive.Int:
                return 'int';
              default:
                throw new Error('Unknown primitive type.');
            }
        } else if (ty instanceof S.FieldTypeArray) {
            return 'arrayLength';
        } else if (ty instanceof S.FieldTypeEnum) {
            return ty.name.name;
        } else if ((ty instanceof S.FieldTypeIface) ||
                   (ty instanceof S.FieldTypeIdent))
        {
            // Ifaces have no value to encode (their
            // components will be encoded under their
            // own context).

            // Idents are encoded through a sequential
            // probability model, ignored in context model.

            return null;
        } else {
            throw new Error('Bad terminal field type.');
        }
    }
}
