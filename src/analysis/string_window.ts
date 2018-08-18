
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {StringSink, ConsoleStringSink}
    from '../data_sink';

export function analyzeStringWindows(
    schema: S.TreeSchema,
    root: TS.Script)
{
    const handler = new StringWindowHandler(64);
    const visitor = S.Visitor.make({schema, root, handler});
    visitor.visit();

    let sumProb = 0;
    for (let entry of handler.counter.summarizeHits()) {
        const {index, count, prob} = entry;

        sumProb += prob;

        const rprob = ((prob * 1000)>>>0) / 10;
        const rsum = ((sumProb * 1000)>>>0) / 10;

        const bits = Math.log(1/prob) / Math.log(2);
        const rbits = ((bits * 100)>>>0) / 100;

        console.log(`HITS ${index} => ${count} ` +
                    `{${rbits}} [${rprob} - ${rsum}]`);
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
        if (shape === S.FieldTypePrimitive.Ident) {
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
