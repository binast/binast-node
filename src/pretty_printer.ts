
import * as assert from 'assert';
import * as S from 'binast-schema';

import {StringSink} from './data_sink';

export class PrettyPrintHandler
  implements S.VisitHandler
{
    readonly sink: StringSink;

    constructor(sink: StringSink) {
        this.sink = sink;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        this.sink.writeLine(...[
            `Begin`,
            `    key = ${key}`,
            `    shape = ${shape.prettyString()}`,
            `    bound = ${bound.prettyString()}`,
            `    value = ${value}`,
            ``,
        ]);
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        this.sink.writeLine(...[
            `End k=${key} v=${value}\n`,
            ``
        ]);
    }
}
