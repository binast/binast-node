#!/usr/bin/env node

import * as assert from 'assert';
import * as fs from 'fs';

import {liftWebidl} from './lift_webidl';
import {TreeSchema} from './tree_schema';
import * as util from './util';

function main() {
    const args = process.argv.slice(2);
    const opts = parseArgs(args);

    // Read the file.
    const idlstr = fs.readFileSync(opts.filename, "utf8");

    // Lift it to TreeSchema.
    const schema = liftWebidl(idlstr, util.symbolToName);

    /*
    console.log("Schema:");
    console.log(schema.prettyString());
    console.log("\n");
    console.log("\n");

    const normSchema = schema.normalize();
    console.log("Normalized schema:");
    console.log(normSchema.prettyString());
    console.log("\n");
    */

    const typeScriptStr = schema.dumpTypescript();
    console.log(typeScriptStr);
}

interface Options {
    filename: string;
}

function parseArgs(args: Array<string>): Options {
    if (args.length === 0) {
        usage('Filename not given.');
    }
    if (args.length > 1) {
        usage('Too many arguments.');
    }
    return {filename: args[0]};
}

function usage(msg?) {
    const usage = [
        'Usage: npm run encoder <filename>'
    ];
    console.log(usage.join('\n'));
    errExit(msg);
}

function errExit(msg?) {
    if (msg) {
        console.error(msg);
    }
    process.exit(1);
}

main();
