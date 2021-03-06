
import * as assert from 'assert';
import * as fs from 'fs';
import * as shift_parser from 'shift-parser';

import {Importer} from './lift_es6';
import * as TS from './typed_schema';

import {FileStringSink, FileByteSink}
    from './data_sink';

import {gzipFile, brotliFile}
    from './the_competition';

/**
 * A simple API for treating a directory of files
 * as a map from 
 * files from a directory as BinAST typed structures.
 */
export class FileStore {
    readonly dir: string;
    readonly filePaths: Set<string>;
    readonly writable: boolean;

    private constructor(dir: string, allowWrite: boolean) {
        this.dir = dir;
        this.filePaths = FileStore.initFiles(dir);
        this.writable = allowWrite &&
            this.filePaths.has('WRITABLE');
    }

    subpaths(): Set<string> {
        return new Set(this.filePaths);
    }

    private fullPath(subpath: string): string {
        return `${this.dir}/${subpath}`;
    }

    isValidSubpath(subpath: string): boolean {
        assert(subpath.match(/^[-_a-zA-Z0-9\.\/]*$/),
               "subpath=" + JSON.stringify(subpath));
        if (subpath === 'WRITABLE') {
            return false;
        }
        if (subpath === '') {
            return true;
        }
        const parts = subpath.split('/');
        return parts.every(p => {
            return (p.length > 0) &&
                   (p !== '.') &&
                   (p !== '..');
        });
    }

    readBytes(subpath: string): Uint8Array {
        assert(this.isValidSubpath(subpath));
        if (! this.filePaths.has(subpath)) {
            throw new Error(`Bad subpath ${subpath}`);
        }
        return new Uint8Array(
            fs.readFileSync(this.fullPath(subpath)));
    }

    readString(subpath: string): string {
        assert(this.isValidSubpath(subpath));
        if (! this.filePaths.has(subpath)) {
            throw new Error(`Bad subpath ${subpath}`);
        }
        return fs.readFileSync(this.fullPath(subpath),
                               "utf8");
    }

    readCompressedBytes(subpath: string, method: string)
      : Uint8Array
    {
        assert(this.isValidSubpath(subpath));
        if (! this.filePaths.has(subpath)) {
            throw new Error(`Bad subpath ${subpath}`);
        }

        const fullPath = this.fullPath(subpath);

        switch (method) {
          case 'gzip':
            return gzipFile(fullPath);
          case 'brotli':
            return brotliFile(fullPath);
          default:
            throw new Error(`Bad compression` +
                            ` method ${method}`);
        }
    }

    readAst(subpath: string): TS.Script {
        const str = this.readString(subpath);
        const astJson = shift_parser.parseScript(str);
        const importer = new Importer();
        return importer.liftScript(astJson);
    }

    readLines(subpath: string): Array<string> {
        assert(this.isValidSubpath(subpath));
        const str = this.readString(subpath);
        return str.split('\n');
    }

    readJSON(subpath: string): any {
        assert(this.isValidSubpath(subpath));
        const str = this.readString(subpath);
        return JSON.parse(str);
    }

    sizeOfFile(subpath: string): number {
        assert(this.isValidSubpath(subpath));

        const fullPath = this.fullPath(subpath);
        return fs.statSync(fullPath).size;
    }

    listAll(subpath: string): Array<string> {
        assert(this.isValidSubpath(subpath));

        const fullPath = this.fullPath(subpath);
        if (! fs.existsSync(fullPath)) {
            throw new Error(`Subdir ${subpath} does not` +
                            ` exist`);
        }
        if (! fs.statSync(fullPath).isDirectory()) {
            throw new Error(`Subpath ${subpath} is not` +
                            ` a directory`);
        }
        return fs.readdirSync(fullPath);
    }
    listFiles(subpath: string): Array<string> {
        assert(this.isValidSubpath(subpath));

        return this.listAll(subpath).filter(child => {
            const childSubpath = `${subpath}/${child}`;
            const fullSubpath = this.fullPath(childSubpath);
            return fs.statSync(fullSubpath).isFile();
        });
    }
    listDirs(subpath: string): Array<string> {
        assert(this.isValidSubpath(subpath));

        return this.listAll(subpath).filter(child => {
            const childSubpath = `${subpath}/${child}`;
            const fullSubpath = this.fullPath(childSubpath);
            return fs.statSync(fullSubpath).isDirectory();
        });
    }

    private checkWritable(subpath: string): string {
        assert(this.isValidSubpath(subpath));
        if (! this.writable) {
            throw new Error(`File store ${this.dir} is` +
                            ` not writable`);
        }

        const parts = subpath.split('/');
        const lastPart = parts.pop();
        for (let i = 0; i < parts.length; i++) {
            const part = parts.slice(0, i+1).join('/');
            const fullPart = this.fullPath(part);
            if (!fs.existsSync(fullPart)) {
                fs.mkdirSync(fullPart);
                continue;
            }

            if ( ! fs.statSync(fullPart).isDirectory()) {
                throw new Error(
                    `Subpath ${subpath} enters non-dir` +
                    ` ${part}`);
            }
        }
        if (lastPart.length == 0) {
            throw new Error(
                `Subpath ${subpath} specifies directory`);
        }

        const fullPath = this.fullPath(subpath);

        // Ensure that the subpath either has nothing
        // or is a file.
        if (fs.existsSync(fullPath) &&
            ! fs.statSync(fullPath).isFile())
        {
            throw new Error(
                `Cannot overwrite non-file ${fullPath}`);
        }

        this.filePaths.add(subpath);
        return fullPath;
    }

    writeBytes(subpath: string, bytes: Uint8Array) {
        const fullPath = this.checkWritable(subpath);
        fs.writeFileSync(fullPath, bytes);
    }

    writeString(subpath: string, data: string) {
        const fullPath = this.checkWritable(subpath);
        fs.writeFileSync(fullPath, data);
    }

    writeJSON(subpath: string, data: any) {
        this.writeString(subpath,
                JSON.stringify(data, null, 2));
    }

    writeSinkString(subpath: string,
                    cb: (FileStringSink) => any)
    {
        const fullPath = this.checkWritable(subpath);
        const fd = fs.openSync(fullPath, 'w');
        const fss = new FileStringSink(fd);
        try {
            cb(fss);
            fss.flush();
        } finally {
            fs.closeSync(fd);
        }
    }

    writeSinkBytes(subpath: string,
                   cb: (FileByteSink) => any)
    {
        const fullPath = this.checkWritable(subpath);
        const fd = fs.openSync(fullPath, 'w');
        const fbs = new FileByteSink(fd);
        try {
            cb(fbs);
            fbs.flush();
        } finally {
            fs.closeSync(fd);
        }
    }

    static openForRead(dir: string) {
        if (! fs.existsSync(dir)) {
            throw new Error(`Path ${dir} does not exist`);
        }
        if ( ! fs.statSync(dir).isDirectory()) {
            throw new Error(`Path ${dir} is not a dir`);
        }
        return new FileStore(dir, false);
    }

    static openOrCreate(dir: string) {
        if (fs.existsSync(dir)) {
            if ( ! fs.statSync(dir).isDirectory()) {
                throw new Error(`Path ${dir} exists and` +
                    ` is not a directory`);
            }
            const exist = new FileStore(dir, true);
            if (! exist.writable) {
                throw new Error(`Dir ${dir} exists and` +
                    ` is a non-writable store.`);
            }
            return exist;
        }

        fs.mkdirSync(dir);
        fs.writeFileSync(`${dir}/WRITABLE`, "writable\n");
        return new FileStore(dir, true);
    }

    private static initFiles(dir: string): Set<string> {
        // Ensure that 'dir' is a directory.
        const dirSt = fs.statSync(dir);
        assert(dirSt.isDirectory(),
               `Store path ${dir} is not a directory`);

        const topFiles = fs.readdirSync(dir);

        // Create a queue of entries to process.
        const queue = topFiles.slice().reverse();

        // The set of file paths.
        const filePaths = new Set<string>();

        while (queue.length > 0) {
            // Pop and process the next item.
            FileStore.processQueue(dir, queue, filePaths);
        }

        return filePaths;
    }

    private static processQueue(dir: string,
                                queue: Array<string>,
                                filePaths: Set<string>)
    {
        const subpath = queue.pop();
        const fullSubpath = `${dir}/${subpath}`;
        const st = fs.statSync(fullSubpath);
        if (st.isFile()) {
            filePaths.add(subpath);
            return;
        }

        if (st.isDirectory()) {
            const entries = fs.readdirSync(fullSubpath);
            const paths = entries.map(
                            e => `${subpath}/${e}`);
            queue.push(...paths.reverse());
        }
    }
}
