
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {Analysis} from '../analysis';
import {FileStore} from '../file_store';

export class StringWindowAnalysis
  extends Analysis
{
    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore)
    {
        super(schema, scriptStore, resultStore);
    }

    get name(): string {
        return 'string-window';
    }

    analyzeAst(subpath: string, script: TS.Script) {
        const handler = new StringWindowHandler(64);
        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();
        const results = handler.counter.summarizeHits();

        assert(subpath.match(/\.js$/));

        const jsonpath = this.dataPath(
            subpath.replace(/\.js$/, '.json'));

        const txtpath = this.dataPath(
            subpath.replace(/\.js$/, '.txt'));

        this.resultStore.writeJSON(jsonpath, results);

        this.resultStore.writeSinkString(txtpath, ss => {
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

    constructor(size: number) {
        this.size = size;
        this.cache = new StringCache(size);
        this.counter = new HitCounter(size);
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        if (shape instanceof S.FieldTypeIdent) {
            assert(value instanceof S.Identifier);
            const name = (value as S.Identifier).name;
            const hitIdx = this.cache.lookup(name);
            this.counter.recordHit(hitIdx);
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
