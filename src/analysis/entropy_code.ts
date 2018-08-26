
import * as assert from 'assert';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';
import * as logger from '../logger';
import {Analysis} from '../analysis';
import {FileStore} from '../file_store';

export class EntropyCodeAnalysis
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
        return 'entropy-code';
    }

    endAnalysis() {
    }

    analyzeAst(subpath: string, script: TS.Script)
    {
        const handler = new EntropyCodeHandler(script);
        const visitor = S.Visitor.make({
            schema: this.schema,
            root: script,
            handler: handler
        });
        visitor.visit();
    }
}

const SUFFIX_LENGTH: number = 2;

class EntropyCodeHandler
  implements S.VisitHandler
{
    readonly root: S.Instance;

    constructor(root: S.Instance) {
        this.root = root;
    }

    begin(schema: S.TreeSchema, loc: S.TreeLocation) {
        const {key, shape, bound, value} = loc;
        logger.log(`BEGIN ${shape.ty.prettyString()} ${key}`);

        // Try to find a match from longest path suffix to
        // shortest.
        let matched: S.PathSuffix|null = null;
        for (let i = SUFFIX_LENGTH; i >= 1; i--) {
            const suffix = S.PathSuffix.forLocation(
                                schema, loc, i);
            if (suffix !== null) {
                matched = suffix;
                break;
            }
        }

        if (!matched) {
            assert(value === this.root);
            return;
        }

        logger.log(`Suffix ${matched.keyString()}`);
    }

    end(schema: S.TreeSchema, loc: S.TreeLocation) {
    }
}
