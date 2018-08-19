
import * as assert from 'assert';
import * as S from 'binast-schema';

import {FileStore} from './file_store';
import * as TS from './typed_schema';

export abstract class Analysis {
    readonly schema: S.TreeSchema;
    readonly scriptStore: FileStore;
    readonly resultStore: FileStore;

    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore)
    {
        this.schema = schema;
        this.scriptStore = scriptStore;
        this.resultStore = resultStore;
    }

    abstract name(): string;

    analyzeScriptFile(subpath: string) {
        const name = this.name();
        this.log(`Analyzing ${subpath} with ${name}`);

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
