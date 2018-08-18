#!/usr/bin/env node

import * as assert from 'assert';
import * as fs from 'fs';
import * as minimist from 'minimist';
import * as shift_parser from 'shift-parser';

import * as S from 'binast-schema';
import * as TS from '../typed_schema';

import {Importer} from '../lift_es6';

import {ConsoleStringSink} from '../data_sink';

import {PrettyPrintHandler} from '../pretty_printer';
import {StringWindowHandler}
    from '../analysis/string_window';

const SCHEMA = TS.ReflectedSchema.schema;

function main() {
    const opts = minimist(process.argv.slice(2));
    if (opts['_'].length !== 1) {
        usage(/* exit = */ true);
    }

    const filename: string = opts['_'][0] as string;
    log("Reading script text.");
    const data: string = fs.readFileSync(filename, 'utf8');
    log("Done reading script text.");
    log("");

    log("Shift-parsing JS source to JSON.");
    const json: string = shift_parser.parseScript(data);
    log("Done shift-parsing JS source to JSON.");
    log("");

    log("Lifting shift-parsed JSON to typed schema.");
    const importer = new Importer();
    const script = importer.liftScript(json);
    log("Done lifting shift-parsed JSON to typed schema.");

    stringWindow(script);
}

function prettyPrint(script: TS.Script) {
    log("Visiting tree.");
    const sink = new ConsoleStringSink();
    const visitor = S.Visitor.make({
        schema: SCHEMA,
        root: script,
        handler: new PrettyPrintHandler(sink)
    });
    visitor.visit();
    sink.flush();
    log("Done visiting tree.");
}

function stringWindow(script: TS.Script) {
    log("Calculating string window statistics.");
    const handler = new StringWindowHandler(256);
    const visitor = S.Visitor.make({
        schema: SCHEMA,
        root: script,
        handler: handler
    });
    visitor.visit();
    log("   ... done.");

    let sumProb = 0;
    for (let entry of handler.counter.summarizeHits()) {
        const {index, count, prob} = entry;

        sumProb += prob;

        const rprob = ((prob * 1000)>>>0) / 10;
        const rsum = ((sumProb * 1000)>>>0) / 10;

        const bits = Math.log(1/prob) / Math.log(2);
        const rbits = ((bits * 100)>>>0) / 100;

        log(`HITS ${index} => ${count} ` +
            `{${rbits}} [${rprob} - ${rsum}]`);
    }
}

const LOG_PREFIX = 'ANALYSIS.log: ';
function log(msg) {
    console.log(LOG_PREFIX
        + msg.replace(/\n/g, '\n' + LOG_PREFIX));
}

function usage(exit: boolean) {
    console.log("Usage: npm run analysis <js-file>");
    if (exit) {
        process.exit(1);
    }
}

main();
