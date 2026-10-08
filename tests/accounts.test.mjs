import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const cwd=new URL('../',import.meta.url),password='Synthetic-test-password-123';
async function start(t,dir){
 const child=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',NODE_ENV:'test',RESERVED_USERNAME:'OwnerUser'}});
 t.after(()=>child.kill('SIGTERM'));
 const origin=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.on('error',reject);child.on('exit',()=>reject(Error('Server exited')));});
 return {child,origin};
}
function client(origin){let cookie='',csrf='';return async(url,method='GET',payload,extra={})=>{
 const r=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...extra},body:payload===undefined?undefined:JSON.stringify(payload)});
 if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 if(data.csrf)csrf=data.csrf;return {status:r.status,data};
};}
test('accounts isolate reads, writes, export, replay keys, sessions, and legacy ownership',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'journal-accounts-'));
 await writeFile(path.join(dir,'seed.json'),JSON.stringify([{measuredAt:'2020-01-01T08:00:00+08:00',weight:77,waist:null,source:'private-legacy-row'}]));
 const {origin}=await start(t,dir);const a=client(origin),b=client(origin),owner=client(origin);
 assert.equal((await a('/api/setup','POST',{password,setupToken:'anything'})).status,410);
 assert.equal((await a('/api/register','POST',{username:'OwnerUser',password})).status,409);
 assert.equal((await a('/api/register','POST',{username:'AliceTest',password})).status,200);
 assert.equal((await a('/api/records')).data.records.length,0);
 assert.equal((await b('/api/register','POST',{username:'alicetest',password})).status,409);
 assert.equal((await b('/api/register','POST',{username:'BobTest',password})).status,200);
 const input={text:'2020-01-02 体重73 腰围83',requestId:'shared-request-123456'};
 const ra=await a('/api/records','POST',input);assert.equal(ra.status,201);
 assert.equal((await a('/api/records','POST',input)).status,200);
 const rb=await b('/api/records','POST',{...input,text:'2020-01-03 体重90'});assert.equal(rb.status,201);assert.equal(rb.data.records[0].weight,90);
 assert.equal((await a('/api/records')).data.records.length,1);assert.equal((await b('/api/records')).data.records.length,1);
 assert.equal((await b('/api/records/'+ra.data.records[0].id,'PATCH',{measuredAt:'2020-01-01T08:00:00+08:00',weight:100,updatedAt:ra.data.records[0].updatedAt})).status,404);
 assert.equal((await a('/api/export')).data.includes('private-legacy-row'),false);assert.equal((await b('/api/export')).data.includes('83'),false);
 assert.equal((await b('/api/records','POST',{...input,requestId:'csrf-check-1234567'},{'X-CSRF-Token':'invalid'})).status,403);
 const provision=spawnSync(process.execPath,['scripts/provision-user.mjs'],{cwd,env:{...process.env,DATA_DIR:dir},input:JSON.stringify({username:'OwnerUser',password,assignLegacy:true}),encoding:'utf8'});
 assert.equal(provision.status,0,provision.stderr);
 assert.equal((await owner('/api/login','POST',{username:'owneruser',password})).status,200);
 const rows=(await owner('/api/records')).data.records;assert.equal(rows.length,1);assert.equal(rows[0].source,'private-legacy-row');
 const again=spawnSync(process.execPath,['scripts/provision-user.mjs'],{cwd,env:{...process.env,DATA_DIR:dir},input:JSON.stringify({username:'OwnerUser',password,assignLegacy:true})});assert.notEqual(again.status,0);
 await a('/api/logout','POST',{});assert.equal((await a('/api/records')).status,401);
 assert.equal((await a('/api/login','POST',{username:'AliceTest',password:'Wrong-password-123'})).status,401);
 assert.equal((await a('/api/login','POST',{username:'AliceTest',password})).status,200);
 const db=new DatabaseSync(path.join(dir,'journal.sqlite'));const stored=db.prepare('SELECT passwordHash FROM users').all();assert.equal(stored.length,3);assert.ok(stored.every(x=>x.passwordHash!==password));assert.equal(new Set(stored.map(x=>x.passwordHash)).size,3);assert.equal(db.prepare('SELECT COUNT(*) n FROM records WHERE userId IS NULL').get().n,0);db.close();
});
test('migration preserves legacy rows and invalidates old global sessions; restart is idempotent',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'journal-migration-'));const file=path.join(dir,'journal.sqlite');let db=new DatabaseSync(file);
 db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,measuredAt TEXT NOT NULL,weight REAL,waist REAL,source TEXT NOT NULL,timeSource TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
 CREATE TABLE sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 INSERT INTO records VALUES ('old-row','2020-01-01T08:00:00+08:00',77,NULL,'old-data','import','created','updated');
 INSERT INTO sessions VALUES ('old-session','csrf',9999999999999);`);db.close();
 const one=await start(t,dir);db=new DatabaseSync(file);assert.equal(db.prepare('SELECT weight,userId FROM records').get().weight,77);assert.equal(db.prepare('SELECT userId FROM records').get().userId,null);assert.equal(db.prepare('SELECT userId FROM sessions').get().userId,null);db.close();
 await new Promise(resolve=>{one.child.once('exit',resolve);one.child.kill('SIGTERM');});
 const two=await start(t,dir);assert.equal((await client(two.origin)('/api/records')).status,401);db=new DatabaseSync(file);assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,1);db.close();
});
