import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {parseInput,validateMeasurement,InputError} from './parser.mjs';
import {migrateMealContext} from './migrations.mjs';
import {migrateAccounts,normalizeUsername,passwordHash,verifyPassword,validPassword} from './accounts.mjs';
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
migrateAccounts(db);
migrateMealContext(db);
try{fs.chmodSync(path.join(data,'journal.sqlite'),0o600);}catch{}
const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting=(k,v)=>db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(k,v);
const prod=process.env.NODE_ENV==='production';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
if(!getSetting('seeded')){
  const seedPath=path.join(data,'seed.json');
  if(fs.existsSync(seedPath)){
    const records=JSON.parse(fs.readFileSync(seedPath,'utf8'));db.exec('BEGIN IMMEDIATE');
    try{for(const r of records){validateMeasurement(r);const now=new Date().toISOString();db.prepare('INSERT INTO records(id,measuredAt,weight,waist,source,timeSource,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),r.measuredAt,r.weight,r.waist,r.source||'导入记录','import',now,now);}setSetting('seeded','1');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
}
const insert=db.prepare('INSERT INTO records(id,measuredAt,weight,waist,source,timeSource,createdAt,updatedAt,userId,mealContext) VALUES (?,?,?,?,?,?,?,?,?,?)');
const readRecords=userId=>db.prepare('SELECT id,measuredAt,weight,waist,source,timeSource,createdAt,updatedAt,mealContext FROM records WHERE userId=? ORDER BY measuredAt,rowid').all(userId);
function limitAuth(req,usernameKey){
 const ip=process.env.TRUST_PROXY==='1'?(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress;
 const keys=[[hash('ip:'+String(ip)),30],[hash('account:'+usernameKey),10]],now=Date.now();
 for(const [key,limit] of keys){const a=db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);if(a&&a.until>now&&a.count>=limit)return false;}
 for(const [key] of keys)db.prepare('INSERT INTO auth_attempts(key,count,until) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END, until=CASE WHEN until>? THEN until ELSE excluded.until END').run(key,now+15*60000,now,now);
 return true;
}
const cookieName=prod?'__Host-body_session':'body_session';
function session(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));if(!cookie)return null;const token=hash(cookie.slice(cookieName.length+1));return db.prepare('SELECT sessions.*,users.username FROM sessions JOIN users ON users.id=sessions.userId WHERE token=? AND expires>?').get(token,Date.now());}
function json(res,status,value,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value));}
function authSession(res,userId){const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');db.prepare('INSERT INTO sessions(token,csrf,expires,userId) VALUES (?,?,?,?)').run(hash(token),csrf,Date.now()+14*86400000,userId);res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600${prod?'; Secure':''}`);return csrf;}
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
  if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{authenticated:!!s,user:s?{username:s.username}:null,csrf:s?.csrf||null});
  if(req.method!=='GET'){
    const origin=req.headers.origin;
    const allowed=process.env.PUBLIC_URL||`${prod?'https':'http'}://${req.headers.host}`;
    if(!origin||origin!==allowed)return json(res,403,{error:'来源验证失败，请从网站页面重新操作。'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'请求格式不正确。'});
  }
  if(req.method==='POST'&&url.pathname==='/api/setup')return json(res,410,{error:'请使用账号注册或登录。'});
  if(req.method==='POST'&&['/api/login','/api/register'].includes(url.pathname)){
    const b=await body(req),username=normalizeUsername(b.username),usernameKey=username.toLowerCase();
    if(!limitAuth(req,usernameKey))return json(res,429,{error:'尝试次数过多，请 15 分钟后重试。'});
    validPassword(b.password);
    let user=db.prepare('SELECT * FROM users WHERE usernameKey=?').get(usernameKey);
    if(url.pathname==='/api/register'){
      if(user)return json(res,409,{error:'该账号名已被使用，请换一个或直接登录。'});
      if(process.env.RESERVED_USERNAME?.toLowerCase()===usernameKey)return json(res,409,{error:'该账号名已被保留，请联系网站所有者。'});
      user={id:crypto.randomUUID(),username,usernameKey};
      db.prepare('INSERT INTO users(id,username,usernameKey,passwordHash,createdAt) VALUES (?,?,?,?,?)').run(user.id,username,usernameKey,passwordHash(b.password),new Date().toISOString());
    }else if(!verifyPassword(b.password,user?.passwordHash))return json(res,401,{error:'账号或密码不正确。'});
    return json(res,200,{ok:true,user:{username:user.username},csrf:authSession(res,user.id)});
  }
  if(!s)return json(res,401,{error:'请先登录。'});
  if(req.method!=='GET'&&!equal(req.headers['x-csrf-token']||'',s.csrf))return json(res,403,{error:'会话验证失败，请刷新页面。'});
  if(req.method==='POST'&&url.pathname==='/api/logout'){db.prepare('DELETE FROM sessions WHERE token=?').run(s.token);res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${prod?'; Secure':''}`);return json(res,200,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/records')return json(res,200,{records:readRecords(s.userId)});
  if(req.method==='GET'&&url.pathname==='/api/export'){
    const rows=[['日期','测量时间（北京时间）','体重（kg）','腰围（cm）','原始记录','测量标注'],...readRecords(s.userId).map(r=>[r.measuredAt.slice(0,10),r.measuredAt.slice(11,16),r.weight,r.waist,r.source,r.mealContext==='after_meal'?'饭后':'未标注'])];
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="body-journal.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));
  }
  if(req.method==='POST'&&url.pathname==='/api/records'){
    const b=await body(req);
    if(typeof b.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId))throw new InputError('请求标识缺失，请刷新页面后重试。');
    const prior=db.prepare('SELECT response FROM user_requests WHERE userId=? AND key=?').get(s.userId,b.requestId);
    if(prior)return json(res,200,JSON.parse(prior.response));
    const records=b.text!==undefined?parseInput(b.text):[validateMeasurement({measuredAt:b.measuredAt,weight:b.weight??null,waist:b.waist??null,source:'手动记录',timeSource:'explicit',mealContext:b.mealContext})];
    const created=records.map(r=>({...r,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
    const result={records:created};
    db.exec('BEGIN IMMEDIATE');
    try{for(const r of created)insert.run(r.id,r.measuredAt,r.weight,r.waist,r.source,r.timeSource,r.createdAt,r.updatedAt,s.userId,r.mealContext);db.prepare('INSERT INTO user_requests(userId,key,response,createdAt) VALUES (?,?,?,?)').run(s.userId,b.requestId,JSON.stringify(result),Date.now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,201,result);
  }
  const edit=url.pathname.match(/^\/api\/records\/([a-f0-9-]{36})$/);
  if(req.method==='PATCH'&&edit){
    const b=await body(req),old=db.prepare('SELECT * FROM records WHERE id=? AND userId=?').get(edit[1],s.userId);if(!old)return json(res,404,{error:'记录不存在。'});
    if(b.updatedAt!==old.updatedAt)return json(res,409,{error:'记录已在其他页面更新，请刷新后再试。'});
    const r=validateMeasurement({measuredAt:b.measuredAt,weight:b.weight??null,waist:b.waist??null,mealContext:b.mealContext===undefined?old.mealContext:b.mealContext});
    const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
    try{db.prepare('INSERT INTO revisions(recordId,previous,changedAt) VALUES (?,?,?)').run(old.id,JSON.stringify(old),now);db.prepare('UPDATE records SET measuredAt=?,weight=?,waist=?,updatedAt=?,mealContext=? WHERE id=? AND userId=?').run(r.measuredAt,r.weight,r.waist,now,r.mealContext,old.id,s.userId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,{ok:true});
  }
  return json(res,404,{error:'接口不存在。'});
 }catch(e){if(e instanceof InputError)return json(res,400,{error:e.message});console.error('Request failed:',e.message);return json(res,500,{error:'保存失败，请稍后重试。已有记录不会被覆盖。'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=40;
const port=Number(process.env.PORT||8793),host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Body Journal running at http://${host}:${server.address().port}`));
setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM auth_attempts WHERE until<?').run(Date.now());},3600000).unref();
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
