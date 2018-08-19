
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {Analysis} from '../analysis';
import {FileStore} from '../file_store';

export const MAX_WINDOW_SIZE: number = 4096;
export const DEFAULT_WINDOW_SIZE: number = 64;

export class StringWindowAnalysis
  extends Analysis
{
    readonly globalCounters: Map<number, HitCounter>;

    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        super(schema, scriptStore, resultStore, opts);
        this.globalCounters = new Map();
    }

    get name(): string {
        return 'string-window';
    }

    getWindowSizes(): Array<number> {
        if (! ('string-window-sizes' in this.opts)) {
            return [DEFAULT_WINDOW_SIZE];
        }
        let sizes = this.opts['string-window-sizes'];
        assert(typeof(sizes) === 'string');
        return sizes.split(',').map(s => {
            assert(s.match(/^[0-9]+$/));
            const n = Number.parseInt(s);
            assert(n <= MAX_WINDOW_SIZE,
               `Window size ${n} >= ${MAX_WINDOW_SIZE}`);
            return Number.parseInt(s);
        });
    }

    endAnalysis() {
        let sizes = Array.from(this.globalCounters.keys())
                         .sort();
        for (let s of sizes) {
            this.summarizeWindowSize(s);
        }
    }

    private summarizeWindowSize(windowSize: number) {
        const hc = this.globalCounters.get(windowSize);
        const results = hc.summarizeHits();

        const jsonpath =
            this.dataPath(`${windowSize}/ALL.json`);
        this.resultStore.writeJSON(jsonpath, results);

        const txtpath =
            this.dataPath(`${windowSize}/ALL.txt`);
        this.generateSummaryReport(txtpath, results);
    }

    private getGlobalCounter(windowSize: number)
      : HitCounter
    {
        if (! this.globalCounters.has(windowSize)) {
            let hc = new HitCounter(windowSize);
            this.globalCounters.set(windowSize, hc);
        }
        return this.globalCounters.get(windowSize);
    }

    analyzeAst(subpath: string, script: TS.Script) {
        for (let ws of this.getWindowSizes()) {
            this.analyzeWindowSize(subpath, script, ws);
        }
    }

    private analyzeWindowSize(subpath: string,
                              script: TS.Script,
                              windowSize: number)
    {
        const globalCounter =
            this.getGlobalCounter(windowSize);

        const handler =
            new StringWindowHandler(windowSize,
                                    globalCounter);

        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();
        const results = handler.counter.summarizeHits();

        assert(subpath.match(/\.js$/));

        const genpath = (rep:string) => {
            return this.dataPath(`${windowSize}/` +
                        subpath.replace(/\.js$/, rep));
        };
        const jsonpath = genpath('.json');
        const txtpath = genpath('.txt');

        this.resultStore.writeJSON(jsonpath, results);
        this.generateSummaryReport(txtpath, results);
    }

    private generateSummaryReport(path: string,
                                  results: Array<HitResult>)
    {
        this.resultStore.writeSinkString(path, ss => {
            let sumProb = 0;
            for (let entry of results) {
                const {index, count, prob} = entry;

                sumProb += prob;

                const rprob = ((prob * 1000)>>>0) / 10;
                const rsum = ((sumProb * 1000)>>>0) / 10;

                const bits = Math.log(1/prob) / Math.log(2);
                const rbits = ((bits * 100)>>>0) / 100;

                ss.write(
                    `HITS ${index} => ${count} ` +
                    `{${rbits}} [${rprob} - ${rsum}]\n`);
            }
        });
    }
}

export class StringWindowHandler
  implements S.VisitHandler
{
    readonly size: number;
    readonly cache: StringCache;
    readonly counter: HitCounter;
    readonly globalCounter: HitCounter;

    constructor(size: number, globalCounter: HitCounter) {
        this.size = size;
        this.cache = new StringCache(size);
        this.counter = new HitCounter(size);
        this.globalCounter = globalCounter;
    }

    private recordHit(hitIdx: number) {
        this.counter.recordHit(hitIdx);
        this.globalCounter.recordHit(hitIdx);
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        if (shape.ty instanceof S.FieldTypeIdent) {
            assert(value instanceof S.Identifier);
            const name = (value as S.Identifier).name;
            const hitIdx = this.cache.lookup(name);
            this.recordHit(hitIdx);
        }
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }
}

export class StringCache {
    readonly limit: number;
    readonly elems: Array<string>;

    constructor(limit: number) {
        this.limit = limit;
        this.elems = [];
    }

    lookup(elem: string): number {
        const elems = this.elems;
        const nelems = elems.length;
        let idx: number = -1;
        let limit = Math.min(this.limit, nelems);
        for (let i = 0; i < limit; i++) {
            if (elems[i] == elem) {
                idx = i;
                break;
            }
        }
        if (idx < 0) {
            this.pushToFront(elem);
            return -1;
        }

        const hit = this.elems.splice(idx, 1)[0];
        this.pushToFront(hit);
        return idx;
    }

    private pushToFront(elem: string) {
        const elems = this.elems;
        elems.unshift(elem);
        if (elems.length >= (this.limit * 2)) {
            elems.splice(this.limit);
        }
    }
}

export type HitResult = {
    index: number|string,
    count: number,
    prob: number,
};

export class HitCounter {
    readonly limit: number;
    readonly hits: Map<number, number>;

    constructor(limit: number) {
        this.limit = limit;
        this.hits = new Map();
    }

    recordHit(index: number) {
        const count = this.hits.get(index) || 1;
        this.hits.set(index, count + 1);
    }

    summarizeHits(): Array<HitResult> {
        const result = [];

        const missCount = this.hitCount(-1);

        let hitTotal: number = 0;
        for (let index = 0; index < this.limit; index++) {
            const count = this.hitCount(index);
            hitTotal += this.hitCount(index);
        }
        const total = hitTotal + missCount;

        for (let index = 0; index < this.limit; index++) {
            const count = this.hitCount(index);
            const prob = count / total;
            result.push({ index, count, prob });
        }

        result.push({
            index: 'MISSES',
            count: missCount,
            prob: missCount / total
        });
        result.push({
            index: 'HITS',
            count: hitTotal,
            prob: hitTotal / total
        });
        result.push({
            index: 'TOTAL',
            count: hitTotal + missCount,
            prob: 1
        });
        return result;
    }

    private hitCount(index: number): number {
        return this.hits.get(index) || 0;
    }
}
