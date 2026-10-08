import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('backup keeps a consistent readable SQLite snapshot',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'body-journal-backup-'));
 const db=new DatabaseSync(path.join(dir,'journal.sqlite'));db.exec('CREATE TABLE records(value REAL); INSERT INTO records VALUES (70.5)');
 const r=spawnSync(process.execPath,['scripts/backup.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATA_DIR:dir},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const copy=new DatabaseSync(r.stdout.trim(),{readOnly:true});assert.equal(copy.prepare('SELECT value FROM records').get().value,70.5);copy.close();db.close();
});
