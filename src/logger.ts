
import * as fs from 'fs';
import * as sleep from 'system-sleep';

export function log(msg: string) {
    for (;;) {
        try {
            fs.writeSync(1, '[LOG] ' + msg + '\n');
            break;
        } catch (err) {
            if (err.code === 'EAGAIN') {
                sleep(100);
                continue;
            }
            throw err;
        }
    }
}
