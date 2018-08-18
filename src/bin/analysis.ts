#!/usr/bin/env node

import * as assert from 'assert';
import * as fs from 'fs';
import * as minimist from 'minimist';
import * as shift_parser from 'shift-parser';

import * as S from 'binast-schema';
import * as TS from '../typed_schema';

import {Importer} from '../lift_es6';

import {prettyPrint}
    from '../analysis/pretty_printer';

import {analyzeStringWindows}
    from '../analysis/string_window';

const SCHEMA = TS.ReflectedSchema.schema;

function main() {
    const opts:any = minimist(process.argv.slice(2));
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

    if (opts['string-windows']) {
        log("Analyzing string windows:");
        analyzeStringWindows(SCHEMA, script);
    }

    if (opts['pretty-print']) {
        log("Pretty printing:");
        prettyPrint(SCHEMA, script);
    }
}

const LOG_PREFIX = 'ANALYSIS: ';
export function log(msg) {
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
