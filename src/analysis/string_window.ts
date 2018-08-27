
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {Analysis} from '../analysis';
import {StringSink} from '../data_sink';
import {FileStore} from '../file_store';
import {StringCache} from '../string_cache';

export const MAX_WINDOW_SIZE: number = 4096;
export const DEFAULT_WINDOW_SIZE: number = 64;

export class StringWindowAnalysis
  extends Analysis
{
    readonly globalCounters: Map<number, CounterGroup>;

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
            assert(n > 0);
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
        const group = this.globalCounters.get(windowSize);
        const results: GroupResult =
            group.summarizeHits();

        const jsonpath =
            this.dataPath(`${windowSize}/ALL.json`);
        this.resultStore.writeJSON(jsonpath, results);

        const txtpath =
            this.dataPath(`${windowSize}/ALL.txt`);
        this.generateSummaryReport(txtpath, results);
    }

    private getGlobalCounters(windowSize: number)
      : CounterGroup
    {
        if (! this.globalCounters.has(windowSize)) {
            let group = new CounterGroup(windowSize);
            this.globalCounters.set(windowSize, group);
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
        const globalCounters =
            this.getGlobalCounters(windowSize);

        const handler =
            new StringWindowHandler(windowSize,
                                    globalCounters);

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
                                  results: GroupResult)
    {
        this.resultStore.writeSinkString(path, ss => {
            ss.write(`WindowSize=${results.windowSize}\n`);

            this.generateTableReport(ss, 'idents',
                                     results.idents);

            this.generateTableReport(ss, 'props',
                                     results.props);

            this.generateTableReport(ss, 'strings',
                                     results.strings);
        });
    }

    private generateTableReport(ss: StringSink,
                                name: string,
                                hits: Array<HitResult>)
    {
        ss.write(`Table ${name}:\n`);

        let sumProb: number = 0;

        for (let entry of hits) {
            const {index, count, prob} = entry;

            sumProb += prob;

            const rprob = ((prob * 1000)>>>0) / 10;
            const rsum = ((sumProb * 1000)>>>0) / 10;

            const bits = Math.log(1/prob) / Math.log(2);
            const rbits = ((bits * 100)>>>0) / 100;

            ss.write(
                `    INDEX ${index}\n` +
                `        hits=${count},` +
                ` bits=${rbits},` +
                ` prob=${rprob},` +
                ` accum=${rsum}\n`);
        }
    }
}

export class StringWindowHandler
  implements S.VisitHandler
{
    readonly size: number;
    readonly identCache: StringCache;
    readonly propCache: StringCache;
    readonly stringCache: StringCache;
    readonly counter: CounterGroup;
    readonly globalCounter: CounterGroup;

    constructor(size: number, globalCounter: CounterGroup) {
        this.size = size;
        this.identCache = new StringCache(size);
        this.propCache = new StringCache(size);
        this.stringCache = new StringCache(size);
        this.counter = new CounterGroup(size);
        this.globalCounter = globalCounter;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        if (shape.ty instanceof S.FieldTypeIdent) {
            assert(value instanceof S.Identifier);
            const name = (value as S.Identifier).name;
            const tag = shape.ty.tag;
            if (tag === 'ident') {
                const idx = this.identCache.lookup(name);
                this.counter.recordIdentHit(idx);
                this.globalCounter.recordIdentHit(idx);
            } else if (tag === 'prop') {
                const idx = this.propCache.lookup(name);
                this.counter.recordPropHit(idx);
                this.globalCounter.recordPropHit(idx);
            } else {
                throw new Error(`Unrecognized prop name ` +
                                            name);
            }
        } else if (shape.ty === S.FieldTypePrimitive.Str) {
            assert(typeof(value) === 'string');

            const idx =
                this.stringCache.lookup(value as string);

            this.counter.recordStringHit(idx);
            this.globalCounter.recordStringHit(idx);
        }
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }
}

export type GroupResult = {
    windowSize: number,
    idents: Array<HitResult>,
    props: Array<HitResult>,
    strings: Array<HitResult>,
};

export class CounterGroup {
    readonly windowSize: number;
    readonly identCounter: HitCounter;
    readonly propCounter: HitCounter;
    readonly stringCounter: HitCounter;

    constructor(windowSize: number) {
        this.windowSize = windowSize;
        this.identCounter = new HitCounter(windowSize);
        this.propCounter = new HitCounter(windowSize);
        this.stringCounter = new HitCounter(windowSize);
    }

    recordIdentHit(index: number) {
        this.identCounter.recordHit(index);
    }
    recordPropHit(index: number) {
        this.propCounter.recordHit(index);
    }
    recordStringHit(index: number) {
        this.stringCounter.recordHit(index);
    }

    summarizeHits(): GroupResult {
        return {
            windowSize: this.windowSize,
            idents: this.identCounter.summarizeHits(),
            props: this.propCounter.summarizeHits(),
            strings: this.stringCounter.summarizeHits()
        };
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
