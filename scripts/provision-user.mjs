// Administrative provisioning over SSH only. Credentials arrive via stdin,
// never command-line arguments. Public registration cannot claim legacy data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {normalizeUsername,passwordHash} from '../accounts.mjs';
const payload=JSON.parse(fs.readFileSync(0,'utf8'));
const username=normalizeUsername(payload.username),digest=passwordHash(payload.password);
const db=new DatabaseSync(path.join(process.env.DATA_DIR||'data','journal.sqlite'));
db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
try{
 if(db.prepare('SELECT 1 FROM users WHERE usernameKey=?').get(username.toLowerCase()))throw Error('Account already exists; no password or ownership was changed.');
 const id=crypto.randomUUID();
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id,username,username.toLowerCase(),digest,new Date().toISOString());
 const assigned=payload.assignLegacy===true?db.prepare('UPDATE records SET userId=? WHERE userId IS NULL').run(id).changes:0;
 db.exec('COMMIT');
 console.log(JSON.stringify({username,assignedLegacyRecords:assigned}));
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
