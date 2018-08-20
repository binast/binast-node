
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
    abstract map(sym: Sym): number | undefined;
    abstract get size(): number;
    abstract symbols(): Iterator<[Sym, number]>;
}

class SetAlphabet extends Alphabet {
    readonly alphas: ReadonlyArray<Sym>;
    readonly alphaMap: ReadonlyMap<Sym, number>;

    constructor(alphas: Array<Sym>) {
        super();
        this.alphas = Object.freeze(alphas);

        let ents = alphas.map((sym, i) => {
            return [sym as Sym, i] as [Sym, number];
        });
        this.alphaMap = new Map(ents);

        Object.freeze(this);
    }

    map(sym: Sym): number | undefined {
        return this.alphaMap.get(sym);
    }

    get size(): number {
        return this.alphas.length;
    }

    symbols(): Iterator<[Sym, number]> {
        const alphas = this.alphas;
        let i = 0;
        return {
            next() {
                const [value, done] =
                    (i >= alphas.length)
                        ? [undefined, true]
                        : [[alphas[i], i] as [Sym, number],
                           false];
                return {value, done};
            }
        };
    }
}
class RangeAlphabet extends Alphabet {
    readonly limit: number;

    constructor(limit: number) {
        super();

        assert(Number.isInteger(limit) && (limit > 0));
        this.limit = limit;
    }

    map(sym: Sym): number | undefined {
        if ((typeof(sym) === 'number') &&
            Number.isInteger(sym))
        {
            if ((sym >= 0) && (sym < this.limit)) {
                return sym as number;
            }
        }
    }

    get size(): number {
        return this.limit;
    }

    symbols(): Iterator<[Sym, number]> {
        const limit = this.limit;
        let i = 0;
        return {
            next() {
                const [value, done] =
                    (i >= this.limit)
                        ? [undefined, true]
                        : [[i, i] as [number, number],
                           false]
                return {value, done};
            }
        };
    }
}

abstract class FreqCounter {
    abstract recordHit(sym: Sym);
}

class SparseFreqCounter extends FreqCounter {
    readonly freqs: Map<number, number>;

    constructor() {
        super();
        this.freqs = new Map();
        Object.freeze(this);
    }

    recordHit(key: number) {
        this.freqs.set(key, (this.freqs.get(key) || 1) + 1);
    }
}

class DenseFreqCounter extends FreqCounter {
    readonly freqs: Uint32Array;

    constructor(limit: number) {
        super();
        this.freqs = new Uint32Array(limit);
        Object.freeze(this);
    }

    recordHit(key: number) {
        assert(key < this.freqs.length);
        this.freqs[key]++;
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
    
    static makeFreqCounter(size: number): FreqCounter {
        return (size <= 256) ? new DenseFreqCounter(size)
                             : new SparseFreqCounter();
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
      : PathSuffix
    {
        assert(Number.isInteger(length) && (length > 0));
        const sliceAccum: Array<PathSlice|null> = [];

        logger.log("KVKV Begin Iter!");
        const iter = loc.ancestors();

        // Start off with the key for the current symbol.
        let symAccum: Array<Sym> = [iter.key];

        // Skip the symbol being visited.
        iter.next();

        for (/**/; !iter.done; iter.next()) {
            logger.log(`KVKV     LEN=${sliceAccum.length}!`);
            if (sliceAccum.length == length) {
                logger.log(`KVKV Accum done!`);
                break;
            }
            const shape = iter.shape;
            logger.log(`KVKV     Got Shape=${shape.prettyString()}`);
            const shapeTy = shape.ty;
            if (! (shapeTy instanceof S.FieldTypeIface)) {
                logger.log(`KVKV     Got Inner!`);
                symAccum.push(iter.key);
                continue;
            }
            // Get the iface and check for node flag.
            const decl = schema.getDecl(shapeTy.name);
            assert(decl instanceof S.Iface);
            const iface = decl as S.Iface;
            logger.log(`KVKV     Got Iface!`);

            if ((iface as S.Iface).isNode) {
                logger.log(`KVKV     Got Node, slicing!`);
                // Arrived at a piece.  Push it.
                const syms = symAccum.reverse();
                symAccum = [iter.key];

                Object.freeze(syms);
                sliceAccum.push(
                    PathSlice.make(iface, syms));
            } else {
                logger.log(`KVKV     Pushing Non-Node Iface!`);
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
        return new PathSuffix(sliceAccum);
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
    }
}

export class PathSuffixHandler
  implements S.VisitHandler
{
    readonly length: number;

    constructor(length: number) {
        this.length = length;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        const suffix = PathSuffix.forLocation(
                            schema, loc, this.length);
        const suffixStr = suffix.keyString();
        const shapeStr = shape.prettyString();
        logger.log(`Suffix ${suffixStr} => ${shapeStr}`);
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }
}
