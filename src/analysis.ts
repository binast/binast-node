
import * as assert from 'assert';
import * as S from 'binast-schema';

import {FileStore} from './file_store';
import * as TS from './typed_schema';

export abstract class Analysis {
    readonly schema: S.TreeSchema;
    readonly scriptStore: FileStore;
    readonly resultStore: FileStore;
    readonly opts: object;

    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        this.schema = schema;
        this.scriptStore = scriptStore;
        this.resultStore = resultStore;
        this.opts = opts;
    }

    abstract get name(): string;

    protected dataPath(sub: string): string {
        return `${this.name}/${sub}`;
    }

    /* Override these to hook into start and end of
     * analysis run.
     */
    beginAnalysis() {}
    endAnalysis() {}

    analyzeFull() {
        this.beginAnalysis();
        for (let subpath of this.scriptStore.subpaths()) {
            // Skip all subpaths not ending in '.js'
            if (! subpath.match(/\.js$/)) {
                continue;
            }

            this.analyzeScriptFile(subpath);
        }
        this.endAnalysis();
    }

    private analyzeScriptFile(subpath: string) {
        this.log(`Analyzing ${subpath} with ${this.name}`);

        const script = this.scriptStore.readAst(subpath);
        this.analyzeAst(subpath, script);
    }

    abstract analyzeAst(subpath: string,
                        script: TS.Script);

    protected log(msg: string) {
        const p = 'ANALYSIS:';
        console.log(p + msg.replace(/\n/g, '\n' + p));
    }
}
