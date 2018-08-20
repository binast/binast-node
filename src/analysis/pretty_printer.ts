
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {Analysis} from '../analysis';
import {FileStore} from '../file_store';
import {StringSink, ConsoleStringSink}
    from '../data_sink';

export class PrettyPrintAnalysis
  extends Analysis
{
    constructor(schema: S.TreeSchema,
                scriptStore: FileStore,
                resultStore: FileStore,
                opts: object)
    {
        super(schema, scriptStore, resultStore, opts);
    }

    get name(): string {
        return 'pretty-print';
    }

    analyzeAst(subpath: string, script: TS.Script) {
        const datapath = this.dataPath(subpath);
        this.resultStore.writeSinkString(datapath, ss => {
            const visitor = S.Visitor.make({
                schema: this.schema,
                root: script,
                handler: new PrettyPrintHandler(ss)
            });
            visitor.visit();
        });
    }
}

export class PrettyPrintHandler
  implements S.VisitHandler
{
    readonly sink: StringSink;
    depth: number;

    constructor(sink: StringSink) {
        this.sink = sink;
        this.depth = 0;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        const shapeStr = shapeString(shape);
        const valueStr = valueString(value, shape);
        const boundStr = bound.prettyString();

        const flattened = bound.flatten(schema);
        assert(flattened instanceof S.TypeSet,
               `Bad flattened: '${flattened}'`);

        this.writeTabbedLines(...[
            `${key}: ${boundStr} = {`,
            `    @ ${shapeStr}`,
            ``,
        ]);
        if (valueStr !== null) {
            this.writeTabbedLines(...[
                `    value = ${valueStr}`
            ]);
        }
        this.depth++;
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        this.depth--;
        this.writeTabbedLines(`}`);
    }

    private writeTabbedLines(...lines: Array<string>) {
        const prefix = '    '.repeat(this.depth);
        this.sink.write(...lines.map(l => {
            return `${prefix}${l}\n`
        }));
    }
}

function shapeString(shape: S.PathShape): string {
    const ty = shape.ty;
    if (ty instanceof S.FieldTypeIface) {
        return `iface(${ty.name.prettyString()})`;
    } else if (ty instanceof S.FieldTypeEnum) {
        return `enum(${ty.name.prettyString()})`;
    } else {
        return shape.prettyString();
    }
}

function valueString(value: S.Value, shape: S.PathShape)
  : string|null
{
    const ty = shape.ty;
    if ((ty instanceof S.FieldTypeIface) ||
        (ty instanceof S.FieldTypeArray))
    {
        return null;
    } else if (ty instanceof S.FieldTypeEnum) {
        assert(typeof(value) === 'string');
        return value.toString();
    } else if (ty instanceof S.FieldTypePrimitive) {
        return `${value}`;
    } else if (ty instanceof S.FieldTypeIdent) {
        const tag = ty.tag;
        assert(value instanceof S.Identifier);
        const ident = value as S.Identifier;
        return ident.name;
    } else {
        throw new Error("Bad PathShape: " + ty);
    }
}

