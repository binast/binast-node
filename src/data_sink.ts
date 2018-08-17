
import * as assert from 'assert';

export type ByteData =
    Uint8Array          // Typed array of bytes
  | Array<number>       // Array of bytes
  | number              // A single byte

export interface ByteSink {
    write(...data: Array<ByteData>): number;
}

export type StringData =
    string          // A raw string

export interface StringSink {
    write(...data: Array<StringData>): number;
}

const INIT_BUFFER_SIZE: number = 256;

export class MemoryByteSink implements ByteSink {
    buffer: Uint8Array;
    written: number;

    constructor() {
        const buf = new Uint8Array(INIT_BUFFER_SIZE);
        this.written = 0;
    }

    write(...data: Array<ByteData>): number {
        let sum: number = 0;
        for (let d of data) {
            sum += this.writePiece(d);
        }
        return sum;
    }

    private writePiece(data: ByteData): number {
        if ((data instanceof Uint8Array) ||
            (data instanceof Array))
        {
            return this.writeArray(data);

        } else {
            assert(typeof(data) === 'number');
            return this.writeByte(data);
        }
    }

    private writeArray(data: Uint8Array|Array<number>)
      : number
    {
        const bytes = data.length;
        if (this.written + bytes > this.buffer.length) {
            this.ensureCapacity(bytes);
        }
        assert(this.capacity() >= bytes);

        const buf = this.buffer;
        const offset = this.written;

        for (let i = 0; i < bytes; i++) {
            buf[offset + i] = data[i];
        }

        return bytes;
    }

    private writeByte(data: number): number {
        assert(Number.isInteger(data) &&
               (data >= 0) && (data <= 0xFF));

        if (this.written >= this.buffer.length) {
            this.ensureCapacity(1);
        }
        assert(this.capacity() > 1);

        this.buffer[this.written] = data;
        return 1;
    }

    private capacity(): number {
        return this.buffer.length - this.written;
    }

    private ensureCapacity(bytes: number) {
        const buf = this.buffer;
        const size = buf.length;
        const desiredSize = this.written + bytes;
        if (size >= desiredSize) {
            return;
        }

        let newSize = size;
        while (newSize < desiredSize) {
            newSize *= 2;
        }
        const newBuf = new Uint8Array(newSize);
        for (let i = 0; i < size; i++) {
            newBuf[i] = buf[i];
        }
        this.buffer = newBuf;
    }
}

export class MemoryStringSink implements StringSink {
    buffer: Array<string>;

    constructor() {
        this.buffer = new Array();
    }

    write(...data: Array<StringData>): number {
        let chars: number = 0;
        for (let d of data) {
            assert(typeof(d) === 'string');
            this.buffer.push(d);
            chars += d.length;
        }
        return chars;
    }

    extractStringArray(): Array<string> {
        const buf = this.buffer;
        this.buffer = [];
        return buf;
    }
}

export class ConsoleStringSink implements StringSink {
    readonly prefix: string;
    readonly accum: Array<string>;

    constructor(prefix: string = '') {
        this.prefix = prefix;
        this.accum = new Array();
    }

    write(...data: Array<StringData>): number {
        let chars: number = 0;
        for (let d of data) {
            assert(typeof(d) === 'string');
            this.accum.push(d);
            chars += d.length;
        }
        const joined = this.accum.splice(0).join('');
        const lines = joined.split('\n');
        if (lines.length > 0) {
            this.accum.push(lines.pop());
        }
        for (let line of lines) {
            this.logLine(line);
        }
        return chars;
    }

    flush() {
        for (let line of this.accum.join('').split('\n')) {
            this.logLine(line);
        }
    }

    private logLine(line: string) {
        console.log(this.prefix + line);
    }
}
