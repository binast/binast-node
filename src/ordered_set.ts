
import * as assert from 'assert';

export class OrderedSet<T> {
    readonly members: Set<T>;
    readonly ordering: Array<T>;

    constructor() {
        this.members = new Set();
        this.ordering = new Array();
    }

    get size(): number {
        return this.members.size;
    }

    add(elem: T) {
        if (!this.members.has(elem)) {
            this.members.add(elem);
            this.ordering.push(elem);
        }
        return this;
    }

    has(elem: T): boolean {
        return this.members.has(elem);
    }

    first(): T {
        assert(this.size > 0);
        return this.ordering[0];
    }

    map<U>(f: (T) => U): OrderedSet<U> {
        const result = new OrderedSet<U>();
        for (let val of this) {
            result.add(f(val));
        }
        return result;
    }

    *entries(): Iterator<T> {
        for (let elem of this.ordering) {
            yield elem;
        }
    }
    [Symbol.iterator](): Iterator<T> {
        return this.entries();
    }

    forEach(f: (T, number?) => any) {
        this.ordering.forEach((v: T, i: number) => {
            f(v)
        });
    }
}
