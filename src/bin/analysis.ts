#!/usr/bin/env node

import * as assert from 'assert';
import * as fs from 'fs';
import * as minimist from 'minimist';

import * as S from 'binast-schema';
import * as TS from '../typed_schema';

import {FileStore} from '../file_store';

import {Analysis} from '../analysis';

import {PrettyPrintAnalysis}
    from '../analysis/pretty_printer';

import {StringWindowAnalysis}
    from '../analysis/string_window';

const SCHEMA = TS.ReflectedSchema.schema;

function main() {
    const opts:any = minimist(process.argv.slice(2));
    assert(opts instanceof Object);

    if (!opts['script-dir']) {
        usage(/* exit = */ true);
    }
    if (!opts['result-dir']) {
        usage(/* exit = */ true);
    }

    const scriptDir = opts['script-dir'] as string;
    const resultDir = opts['result-dir'] as string;

    const scriptStore = FileStore.openForRead(scriptDir);
    const resultStore = FileStore.openOrCreate(resultDir);

    const analyses: Array<string> = [];
    if (opts['string-window']) {
        analyses.push('string-window');
    }
    if (opts['pretty-print']) {
        analyses.push('pretty-print');
    }

    runStoreSuite(SCHEMA, scriptStore, resultStore,
                     analyses, opts as object);
}

function runStoreSuite(schema: S.TreeSchema,
                       scriptStore: FileStore,
                       resultStore: FileStore,
                       analyses: Array<string>,
                       opts: object)
{
    // Create the appropriate analysis task for
    // each specified analysis.
    const analysisTasks: Array<Analysis> = [];
    for (let analysis of analyses) {
        analysisTasks.push(makeAnalysisTask(
            analysis, schema,
            scriptStore, resultStore,
            opts));
    }

    for (let task of analysisTasks) {
        task.analyzeFull();
    }
}

function makeAnalysisTask(name: string,
                          schema: S.TreeSchema,
                          scriptStore: FileStore,
                          resultStore: FileStore,
                          opts: object)
  : Analysis
{
    switch (name) {
      case 'pretty-print':
        return new PrettyPrintAnalysis(
                    schema, scriptStore, resultStore, opts);
      case 'string-window':
        return new StringWindowAnalysis(
                    schema, scriptStore, resultStore, opts);
    }
    throw new Error(`Unknown analysis ${name}`);
}

const LOG_PREFIX = 'ANALYSIS: ';
export function log(msg) {
    console.log(LOG_PREFIX
        + msg.replace(/\n/g, '\n' + LOG_PREFIX));
}

function usage(exit: boolean) {
    console.log("Usage: npm run analysis [opts]");
    console.log("Options:");
    console.log("   --script-dir=<scriptDir>            " +
                "        Input scripts directory.");
    console.log("   --result-dir=<outDir>               " +
                "        Output data directory.");
    console.log("");
    console.log("   --pretty-print                      " +
                "        Run pretty-print analysis.");
    console.log("");
    console.log("   --string-window                     " +
                "        Run string-window analysis.");
    console.log("   --string-window-sizes=num,num,...   " +
                "        Window sizes to analyze.");
    if (exit) {
        process.exit(1);
    }
}

main();
