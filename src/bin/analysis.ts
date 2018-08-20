#!/usr/bin/env node

import * as assert from 'assert';
import * as fs from 'fs';
import * as minimist from 'minimist';
import * as S from 'binast-schema';

import * as TS from '../typed_schema';
import * as logger from '../logger';

import {FileStore} from '../file_store';

import {Analysis} from '../analysis';

import {PrettyPrintAnalysis}
    from '../analysis/pretty_printer';

import {StringWindowAnalysis}
    from '../analysis/string_window';

import {PathSuffixAnalysis}
    from '../analysis/path_suffix';

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
    if (opts['path-suffix']) {
        analyses.push('path-suffix');
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
      case 'path-suffix':
        return new PathSuffixAnalysis(
                    schema, scriptStore, resultStore, opts);
    }
    throw new Error(`Unknown analysis ${name}`);
}

function usage(exit: boolean) {
    logger.log("Usage: npm run analysis [opts]");
    logger.log("Options:");
    logger.log("   --script-dir=<scriptDir>            " +
               "        Input scripts directory.");
    logger.log("   --result-dir=<outDir>               " +
               "        Output data directory.");
    logger.log("");
    logger.log("   --pretty-print                      " +
               "        Run pretty-print analysis.");
    logger.log("");
    logger.log("   --string-window                     " +
               "        Run string-window analysis.");
    logger.log("   --string-window-sizes=num,num,...   " +
               "        Window sizes to analyze.");
    logger.log("");
    logger.log("   --path-suffix                       " +
               "        Run path-suffix analysis.");
    logger.log("   --path-suffix-length=length         " +
               "        Suffix length to use.");
    if (exit) {
        process.exit(1);
    }
}

main();
