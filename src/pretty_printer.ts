
import * as assert from 'assert';
import * as S from 'binast-schema';

import {StringSink} from './data_sink';

function shapeString(shape: S.PathShape): string
{
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
    if ((shape instanceof S.Iface) ||
        (shape instanceof S.Enum) ||
        (shape instanceof S.FieldTypeArray))
    {
        return null;
    } else if (shape instanceof S.FieldTypeOpt) {
        assert(value === null);
        return 'null';
    } else if (shape instanceof S.FieldTypePrimitive) {
        if (value instanceof S.Identifier) {
            return value.name;
        } else {
            return value.toString();
        }
    }
    throw new Error("Bad PathShape: " + shape);
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
            `${key}: ${shapeStr} {`,
            `    bound=${boundStr}`
        ]);
        if (valueStr !== null) {
            this.writeTabbedLines(...[
                `    value=${valueStr}`
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
