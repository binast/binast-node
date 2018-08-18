
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';

import {StringSink, ConsoleStringSink}
    from '../data_sink';

export function prettyPrint(schema: S.TreeSchema,
                            root: TS.Script)
{
    const sink = new ConsoleStringSink();
    const handler = new PrettyPrintHandler(sink);
    const visitor = S.Visitor.make({schema, root, handler});
    visitor.visit();
    sink.flush();
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

        this.writeTabbedLines(...[
            `${key}: ${boundStr} = {`,
            `    @ ${shapeStr}`,
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
    if (shape instanceof S.Iface) {
        return `iface(${shape.name.prettyString()})`;
    } else if (shape instanceof S.Enum) {
        return `enum(${shape.name.prettyString()})`;
    } else {
        return shape.prettyString();
    }
}

function valueString(value: S.Value, shape: S.PathShape)
  : string|null
{
    if ((shape instanceof S.FieldTypeIface) ||
        (shape instanceof S.FieldTypeArray))
    {
        return null;
    } else if (shape instanceof S.FieldTypeEnum) {
        assert(typeof(value) === 'string');
        return value.toString();
    } else if (shape instanceof S.FieldTypePrimitive) {
        return `${value}`;
    } else if (shape instanceof S.FieldTypeIdent) {
        const tag = shape.tag;
        assert(value instanceof S.Identifier);
        const ident = value as S.Identifier;
        return ident.name;
    } else {
        throw new Error("Bad PathShape: " + shape);
    }
}

