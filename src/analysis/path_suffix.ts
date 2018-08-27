
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

export type Sym = string|number;

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
        return result;
    }
}

const DEFAULT_PATH_SUFFIX_LENGTH: number = 1;
const MAX_PATH_SUFFIX_LENGTH: number = 3;

export class PathSuffixAnalysis
  extends Analysis
{
    readonly globalFreqMap: Map<string, FreqTable>;
    totalSymbolsEmitted: number;

    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        super(schema, scriptStore, resultStore, opts);
        this.globalFreqMap = new Map();
        this.totalSymbolsEmitted = 0;
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
        const suffixLength = this.getSuffixLength();
        const results = summarizeFreqs(this.globalFreqMap,
                                this.totalSymbolsEmitted);

        const jsonpath =
            this.dataPath(`${suffixLength}/ALL.json`);
        this.resultStore.writeJSON(jsonpath, results);

        const txtpath =
            this.dataPath(`${suffixLength}/ALL.txt`);
        this.generateSummaryReport(txtpath, results,
                                this.totalSymbolsEmitted);
    }

    analyzeAst(subpath: string, script: TS.Script)
    {
        const suffixLength = this.getSuffixLength();
        const handler = new PathSuffixHandler(suffixLength,
                                    this.globalFreqMap);

        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();

        const results = handler.summarizeFreqs(
                                    handler.symbolsEmitted);

        assert(subpath.match(/\.js$/));
        this.totalSymbolsEmitted += handler.symbolsEmitted;

        const genpath = (rep:string) => {
            return this.dataPath(`${suffixLength}/` +
                        subpath.replace(/\.js$/, rep));
        };
        const jsonpath = genpath('.json');
        const txtpath = genpath('.txt');

        this.resultStore.writeJSON(jsonpath, results);
        this.generateSummaryReport(txtpath, results,
                                   handler.symbolsEmitted);
    }

    private generateSummaryReport(
        path: string,
        results: Array<FreqResult>,
        symbolsEmitted: number)
    {
        this.resultStore.writeSinkString(path, ss => {
            for (let entry of results) {
                const {suffix, totalHits, freqs} = entry;

                const pctHits = totalHits / symbolsEmitted;
                const rpctHits =
                    ((pctHits * 10000)>>>0) / 100;

                ss.write(`Suffix ${suffix}\n` +
                         `  [hits=${totalHits}/` +
                                 `${symbolsEmitted}]` +
                            ` ${rpctHits}%]\n`);

                let sumProb = 0;
                for (let freq of freqs) {
                    let {name, index, hits} = freq;

                    const prob = hits / totalHits;
                    sumProb += prob;

                    const rprob =
                        ((prob * 10000)>>>0) / 100;
                    const rsum =
                        ((sumProb * 10000)>>>0) / 100;

                    const bits =
                        Math.log(1/prob) / Math.log(2);
                    const rbits =
                        ((bits * 100)>>>0) / 100;

                    ss.write(
                        `    ${name}\n` +
                        `        hits=${hits},` +
                        ` bits=${rbits},` +
                        ` prob = ${rprob},` +
                        ` accum = ${rsum}\n\n`);
                }
            }
        });
    }
}

function summarizeFreqs(freqMap: Map<string, FreqTable>,
                        totalSymbols: number)
  : Array<FreqResult>
{
    // Sort the suffixes by freqTable totals,
    // largest to smallest.
    const taggedSuffixes =
        Array.from(freqMap.keys())
            .sort((a:string , b:string) => {
                const al = a.replace(/[^\/]/g, '').length;
                const bl = b.replace(/[^\/]/g, '').length;

                // Order more specific contexts over
                // less specific ones.
                if (al !== bl) {
                    return bl - al;
                }

                const ax = freqMap.get(a);
                const bx = freqMap.get(b);
                return bx.totalHits - ax.totalHits;
            });
    const result: Array<FreqResult> = [];
    for (let suffix of taggedSuffixes) {
        const ftable = freqMap.get(suffix);
        // Don't print out tables for alphabets of
        // size 1.  They are always perfectly predicted.
        if (ftable.alphabet.size === 1) {
            continue;
        }
        result.push({
            suffix: suffix,
            totalHits: ftable.totalHits,
            totalSymbols: totalSymbols,
            freqs: ftable.summarizeFreqs()
        });
    }
    return result;
}

type HitResult = {
    name: Sym,
    index: number,
    hits: number
};
type FreqResult = {
    suffix: string,
    totalHits: number,
    totalSymbols: number,
    freqs: Array<HitResult>
};

class PathSuffixHandler
  implements S.VisitHandler
{
    readonly suffixLength: number;
    readonly globalFreqMap: Map<string, FreqTable>;
    readonly suffixFreqMap: Map<string, FreqTable>;
    readonly alphabetCache: Map<S.TypeSet, Alphabet>;
    readonly valueAlphabetCache:
        Map<string, Alphabet>;
    symbolsEmitted: number;

    constructor(suffixLength: number,
                globalFreqMap: Map<string, FreqTable>)
    {
        this.suffixLength = suffixLength;
        this.globalFreqMap = globalFreqMap;
        this.suffixFreqMap = new Map();
        this.alphabetCache = new Map();
        this.valueAlphabetCache = new Map();
        this.symbolsEmitted = 0;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        ++this.symbolsEmitted;
        const {key, shape, bound, value} = loc;

        for (let len = 1; len <= this.suffixLength; len++) {
            const suffix = S.PathSuffix.forLocation(
                                        schema, loc, len);
            if (suffix === null) {
                return;
            }

            this.updateFreqTables(schema, shape, suffix,
                value, this.globalFreqMap);
            this.updateFreqTables(schema, shape, suffix,
                value, this.suffixFreqMap);
        }
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
        // const {key, shape, bound, value} = loc;
    }

    private updateFreqTables(
        schema: S.TreeSchema,
        shape: S.PathShape,
        suffix: S.PathSuffix,
        value: S.Value,
        freqMap: Map<string, FreqTable>)
    {
        const suffixStr = suffix.keyString();
        const freqs =
            this.getFreqsFrom(
                schema, suffix, shape, 'type', freqMap,
                // Alphabet generator.
                () => {
                    return this.getAlphabet(
                            schema, suffix, shape);
                });

        // No type to encode.
        if (freqs !== null) {
            freqs.recordHit(shape.index);
        }

        const tagValIdx = suffix.valueTagAndIndex(
                            schema, shape.ty, value);
        if (tagValIdx === null) {
            return;
        }
        const [valTag, valIdx, alphaChars] = tagValIdx;

        const valFreqs =
            this.getFreqsFrom(
                schema, suffix, shape, valTag, freqMap,
                // Alphabet generator.
                () => {
                    return this.getValueAlphabet(
                            schema, valTag, alphaChars);
                });

        if (valFreqs === null) {
            return;
        }
        valFreqs.recordHit(valIdx);
    }

    summarizeFreqs(totalSymbols: number): Array<FreqResult>
    {
        return summarizeFreqs(this.suffixFreqMap,
                              totalSymbols);
    }

    private getFreqsFrom(
        schema: S.TreeSchema,
        suffix: S.PathSuffix,
        shape: S.PathShape,
        tag: string,
        freqMap: Map<string, FreqTable>,
        alphaF: () => Alphabet)
      : FreqTable|null
    {
        const suffixStr = suffix.keyString();
        const suffixTag = `${suffixStr}#${tag}`;
        const existing = freqMap.get(suffixTag);
        if (existing) {
            return existing;
        }
        const alphabet = alphaF();
        const freqTable = new FreqTable(alphabet);
        freqMap.set(suffixTag, freqTable);
        return freqTable;
    }

    private getAlphabet(schema: S.TreeSchema,
                        suffix: S.PathSuffix,
                        shape: S.PathShape)
      : Alphabet
    {
        const tySet = shape.typeSet;
        const existing = this.alphabetCache.get(tySet);
        if (existing) {
            return existing;
        }
        const symbols = shape.typeSet.tys.map(ty => {
            return ty.prettyString();
        });
        const created = new NamedAlphabet(symbols);
        this.alphabetCache.set(tySet, created);
        return created;
    }

    private getValueAlphabet(
                schema: S.TreeSchema,
                tag: string,
                alphaChars: Array<string|number>)
      : Alphabet
    {
        const existing = this.valueAlphabetCache.get(tag);
        if (existing) {
            return existing;
        }
        const created = new NamedAlphabet(alphaChars);
        this.valueAlphabetCache.set(tag, created);
        return created;
    }
}
