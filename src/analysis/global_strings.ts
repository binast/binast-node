
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {Analysis} from '../analysis';
import {StringSink} from '../data_sink';
import {FileStore} from '../file_store';

function jsonStr(s) {
    JSON.stringify(s);
}

export class GlobalStringsAnalysis
  extends Analysis
{
    readonly globalStrings: StringTable;

    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        super(schema, scriptStore, resultStore, opts);
        this.globalStrings = new StringTable();
    }

    get name(): string {
        return 'global-strings';
    }

    endAnalysis() {
        let results = this.globalStrings.summarizeCounts();

        const jsonpath = this.dataPath(`ALL.json`);
        this.resultStore.writeJSON(jsonpath, results);

        const txtpath = this.dataPath(`ALL.txt`);
        this.generateSummaryReport(txtpath, results);
    }

    analyzeAst(subpath: string, script: TS.Script) {
        const handler =
            new GlobalStringsHandler(this.globalStrings);
        
        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();
        const results = handler.counter.summarizeCounts();

        assert(subpath.match(/\.js$/));

        const genpath = (rep:string) => {
            return this.dataPath(
                        subpath.replace(/\.js$/, rep));
        };
        const jsonpath = genpath('.json');
        const txtpath = genpath('.txt');

        this.resultStore.writeJSON(jsonpath, results);
        this.generateSummaryReport(txtpath, results);
    }

    private generateSummaryReport(path: string,
                      results: Array<StringCountResult>)
    {
        this.resultStore.writeSinkString(path, ss => {
            for (let entry of results) {
                const {str, idx,
                       identCount,
                       propCount,
                       rawCount} = entry;

                const totalCount =
                    identCount + propCount + rawCount;

                const strRepr = jsonStr(str);
                ss.write(
                    `STRING ${idx}` +
                    ` length=${str.length}` +
                    ` identCount=${identCount}` +
                    ` propCount=${propCount}` +
                    ` rawCount=${rawCount}\n` +
                    ` >> ${strRepr}\n\n`);
            }
        });
    }
}

export class GlobalStringsHandler
  implements S.VisitHandler
{
    readonly counter: StringTable;
    readonly globalCounter: StringTable;

    constructor(globalCounter: StringTable) {
        this.counter = new StringTable();
        this.globalCounter = globalCounter;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        if (shape.ty instanceof S.FieldTypeIdent) {
            assert(value instanceof S.Identifier);
            const name = (value as S.Identifier).name;
            const tag = shape.ty.tag;
            if (tag === 'ident') {
                this.counter.recordIdent(name);
                this.globalCounter.recordIdent(name);
            } else if (tag === 'prop') {
                this.counter.recordProp(name);
                this.globalCounter.recordProp(name);
            } else {
                throw new Error(`Unrecognized prop name ` +
                                            name);
            }
        } else if (shape.ty === S.FieldTypePrimitive.Str) {
            assert(typeof(value) === 'string');
            this.counter.recordRaw(value as string);
            this.globalCounter.recordRaw(value as string);
        }
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }
}

export type StringCountResult = {
    str: string,
    idx: number,
    identCount: number,
    propCount: number,
    rawCount: number,
    totalCount: number
};

const STRING_TAG_IDENT: number = 0x01;
const STRING_TAG_PROP: number = 0x02;
const STRING_TAG_RAW: number = 0x04;

export class StringTable {
    readonly strings: Array<string>;
    readonly stringIdentCounts: Array<number>;
    readonly stringPropCounts: Array<number>;
    readonly stringRawCounts: Array<number>;
    readonly stringIndices: Map<string, number>;

    constructor() {
        this.strings = new Array();
        this.stringIdentCounts = new Array();
        this.stringPropCounts = new Array();
        this.stringRawCounts = new Array();
        this.stringIndices = new Map();
    }

    private recordString(str: string): number {
        const idx = this.stringIndices.get(str);
        if (typeof(idx) === 'number') {
            return idx;
        }
        const newIdx = this.strings.length;
        this.strings.push(str);
        this.stringIdentCounts.push(0);
        this.stringPropCounts.push(0);
        this.stringRawCounts.push(0);
        this.stringIndices.set(str, newIdx);
        return newIdx;
    }

    recordIdent(str: string) {
        const idx = this.recordString(str);
        ++this.stringIdentCounts[idx];
    }
    recordProp(str: string) {
        const idx = this.recordString(str);
        ++this.stringPropCounts[idx];
    }
    recordRaw(str: string) {
        const idx = this.recordString(str);
        ++this.stringRawCounts[idx];
    }

    summarizeEntry(str: string): StringCountResult
    {
        const idx = this.stringIndices.get(str);

        const identCount = this.stringIdentCounts[idx];
        const propCount = this.stringPropCounts[idx];
        const rawCount = this.stringRawCounts[idx];

        const totalCount =
            identCount + propCount + rawCount;

        return {str, idx,
                identCount,
                propCount,
                rawCount,
                totalCount};
    }

    summarizeCounts(): Array<StringCountResult>
    {
        return this.strings.map(str => {
            return this.summarizeEntry(str);
        }).sort((a, b) => {
            return b.totalCount - a.totalCount;
        });
    }
}
