
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

