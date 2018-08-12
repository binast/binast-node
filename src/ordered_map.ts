
import * as assert from 'assert';

export class OrderedMap<K, V> {
    readonly members: Map<K, V>;
    readonly ordering: Array<K>;

    constructor() {
        this.members = new Map();
        this.ordering = new Array();
    }

    get size(): number {
        return this.members.size;
    }

    set(key: K, val: V) {
        assert(!this.members.has(key));
        this.members.set(key, val);
        this.ordering.push(key);
    }

    has(key: K): boolean {
        return this.members.has(key);
    }

    get(key: K): V {
        assert(this.members.has(key));
        return this.members.get(key);
    }
    maybeGet(key: K): V|undefined {
        return this.members.get(key);
    }

    *entries() {
        for (let key of this.ordering) {
            yield [key, this.members.get(key)];
        }
    }
    *keys() {
        for (let key of this.ordering) {
            yield key;
        }
    }
    *values() {
        for (let key of this.ordering) {
            yield this.members.get(key);
        }
    }

    forEach(f: (V, K) => any) {
        this.ordering.forEach((k: K) => {
            const v = this.members.get(k);
            f(v, k);
        });
    }
}
