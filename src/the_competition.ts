
import * as assert from 'assert';
import * as fs from 'fs';
import {execSync} from 'child_process';

export function gzipFile(filename: string): Uint8Array {
    return new Uint8Array(
        execSync(`gzip -c <"${filename}"`));
}
export function brotliFile(filename: string): Uint8Array {
    return new Uint8Array(
        execSync(`brotli -q 11 -c <"${filename}"`));
}
export function brotliBytes(data: Uint8Array): Uint8Array {
    const fn = `/tmp/brotli-input-${process.pid}`;
    fs.writeFileSync(fn, data);
    const result = brotliFile(fn);
    fs.unlinkSync(fn);
    return result;
}
