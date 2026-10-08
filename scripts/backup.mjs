import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const directory=path.resolve(process.env.DATA_DIR||'data');
const backupDir=path.join(directory,'backups');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
const name=path.join(backupDir,`journal-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=new DatabaseSync(path.join(directory,'journal.sqlite'),{readOnly:true});
db.prepare('VACUUM INTO ?').run(name);db.close();fs.chmodSync(name,0o600);console.log(name);
