import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {parseInput,validateMeasurement,InputError} from './parser.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
fs.mkdirSync(data,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(data,'journal.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,measuredAt TEXT NOT NULL,weight REAL,waist REAL,source TEXT NOT NULL,timeSource TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_records_measuredAt ON records(measuredAt,createdAt);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,recordId TEXT NOT NULL,previous TEXT NOT NULL,changedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,response TEXT NOT NULL,createdAt INTEGER NOT NULL);`);
try{fs.chmodSync(path.join(data,'journal.sqlite'),0o600);}catch{}
const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting=(k,v)=>db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(k,v);
const prod=process.env.NODE_ENV==='production';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function passwordHash(p){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');}
function verifyPassword(p){const stored=getSetting('password');if(!stored)return false;const [salt,digest]=stored.split(':');return equal(crypto.scryptSync(p,salt,64).toString('hex'),digest);}
function validPassword(p){if(typeof p!=='string'||p.length<12||p.length>128)throw new InputError('密码请使用 12–128 个字符。');}
if(!getSetting('seeded')){
  const seedPath=path.join(data,'seed.json');
  if(fs.existsSync(seedPath)){
    const records=JSON.parse(fs.readFileSync(seedPath,'utf8'));db.exec('BEGIN IMMEDIATE');
    try{for(const r of records){validateMeasurement(r);const now=new Date().toISOString();db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),r.measuredAt,r.weight,r.waist,r.source||'导入记录','import',now,now);}setSetting('seeded','1');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
}
let setupToken='';
if(prod&&!getSetting('password')){
 const tokenFile=path.join(data,'setup-token.txt');
 setupToken=fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():crypto.randomBytes(24).toString('hex');
 if(!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,setupToken,{mode:0o600});
 console.log('首次设置令牌位于受保护的数据目录 setup-token.txt，请通过 SSH 获取。');
}
const insert=db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?)');
const readRecords=()=>db.prepare('SELECT * FROM records ORDER BY measuredAt,rowid').all();
const attempts=new Map();
const cookieName=prod?'__Host-body_session':'body_session';
function session(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));if(!cookie)return null;const token=hash(cookie.slice(cookieName.length+1));return db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now());}
function json(res,status,value,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value));}
function authSession(res){const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),csrf,Date.now()+14*86400000);res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600${prod?'; Secure':''}`);return csrf;}
async function body(req){let total=0,chunks=[];for await(const chunk of req){total+=chunk.length;if(total>16384)throw new InputError('请求过大。');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('请求格式不正确。');}}
function csvCell(v){let s=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(s)&&typeof v==='string')s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
const assets=new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']],['/favicon.svg',['favicon.svg','image/svg+xml']]]);
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost');
 try{
  if(req.method==='GET'&&assets.has(url.pathname)){const [file,type]=assets.get(url.pathname);res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(path.join(root,'public',file)).pipe(res);}
  if(url.pathname==='/healthz'&&req.method==='GET')return json(res,200,{ok:true});
  if(!url.pathname.startsWith('/api/'))return json(res,404,{error:'页面不存在。'});
  if(!['GET','POST','PATCH'].includes(req.method))return json(res,405,{error:'不支持此操作。'});
  const s=session(req);
  if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{authenticated:!!s,setupRequired:!getSetting('password'),setupTokenRequired:prod,csrf:s?.csrf||null});
  if(req.method!=='GET'){
    const origin=req.headers.origin;
    const allowed=process.env.PUBLIC_URL||`${prod?'https':'http'}://${req.headers.host}`;
    if(!origin||origin!==allowed)return json(res,403,{error:'来源验证失败，请从网站页面重新操作。'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'请求格式不正确。'});
  }
  if(req.method==='POST'&&['/api/login','/api/setup'].includes(url.pathname)){
    const ip=prod?(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress;
    const key=String(ip).slice(0,80), now=Date.now();
    const a=attempts.get(key);if(a&&a.until>now&&a.count>=8)return json(res,429,{error:'尝试次数过多，请 15 分钟后重试。'});
    const b=await body(req);validPassword(b.password);
    attempts.set(key,{count:a&&a.until>now?a.count+1:1,until:a&&a.until>now?a.until:now+15*60000});
    if(url.pathname==='/api/setup'){
      if(getSetting('password'))return json(res,409,{error:'账户已创建，请登录。'});
      if(prod&&!equal(b.setupToken||'',setupToken))return json(res,403,{error:'设置令牌不正确。'});
      if(!prod&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(res,403,{error:'首次设置需要在本机完成。'});
      setSetting('password',passwordHash(b.password));
    }else if(!verifyPassword(b.password))return json(res,401,{error:'密码不正确。'});
    attempts.delete(key);return json(res,200,{ok:true,csrf:authSession(res)});
  }
  if(!s)return json(res,401,{error:'请先登录。'});
  if(req.method!=='GET'&&!equal(req.headers['x-csrf-token']||'',s.csrf))return json(res,403,{error:'会话验证失败，请刷新页面。'});
  if(req.method==='POST'&&url.pathname==='/api/logout'){db.prepare('DELETE FROM sessions WHERE token=?').run(s.token);res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${prod?'; Secure':''}`);return json(res,200,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/records')return json(res,200,{records:readRecords()});
  if(req.method==='GET'&&url.pathname==='/api/export'){
    const rows=[['日期','测量时间（北京时间）','体重（kg）','腰围（cm）','原始记录'],...readRecords().map(r=>[r.measuredAt.slice(0,10),r.measuredAt.slice(11,16),r.weight,r.waist,r.source])];
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="body-journal.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));
  }
  if(req.method==='POST'&&url.pathname==='/api/records'){
    const b=await body(req);
    if(typeof b.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId))throw new InputError('请求标识缺失，请刷新页面后重试。');
    const prior=db.prepare('SELECT response FROM requests WHERE key=?').get(b.requestId);
    if(prior)return json(res,200,JSON.parse(prior.response));
    const records=b.text!==undefined?parseInput(b.text):[validateMeasurement({measuredAt:b.measuredAt,weight:b.weight??null,waist:b.waist??null,source:'手动记录',timeSource:'explicit'})];
    const created=records.map(r=>({...r,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
    const result={records:created};
    db.exec('BEGIN IMMEDIATE');
    try{for(const r of created)insert.run(r.id,r.measuredAt,r.weight,r.waist,r.source,r.timeSource,r.createdAt,r.updatedAt);db.prepare('INSERT INTO requests VALUES (?,?,?)').run(b.requestId,JSON.stringify(result),Date.now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,201,result);
  }
  const edit=url.pathname.match(/^\/api\/records\/([a-f0-9-]{36})$/);
  if(req.method==='PATCH'&&edit){
    const b=await body(req),old=db.prepare('SELECT * FROM records WHERE id=?').get(edit[1]);if(!old)return json(res,404,{error:'记录不存在。'});
    if(b.updatedAt!==old.updatedAt)return json(res,409,{error:'记录已在其他页面更新，请刷新后再试。'});
    const r=validateMeasurement({measuredAt:b.measuredAt,weight:b.weight??null,waist:b.waist??null});
    const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
    try{db.prepare('INSERT INTO revisions(recordId,previous,changedAt) VALUES (?,?,?)').run(old.id,JSON.stringify(old),now);db.prepare('UPDATE records SET measuredAt=?,weight=?,waist=?,updatedAt=? WHERE id=?').run(r.measuredAt,r.weight,r.waist,now,old.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,{ok:true});
  }
  return json(res,404,{error:'接口不存在。'});
 }catch(e){if(e instanceof InputError)return json(res,400,{error:e.message});console.error('Request failed:',e.message);return json(res,500,{error:'保存失败，请稍后重试。已有记录不会被覆盖。'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=40;
const port=Number(process.env.PORT||8793),host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Body Journal running at http://${host}:${server.address().port}`));
setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());for(const [k,v]of attempts)if(v.until<Date.now())attempts.delete(k);},3600000).unref();
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
