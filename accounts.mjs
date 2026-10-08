import crypto from 'node:crypto';
import {InputError} from './parser.mjs';

export function normalizeUsername(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9_]{3,32}$/.test(value.trim()))throw new InputError('账号请使用 3–32 位字母、数字或下划线。');
 return value.trim();
}
export function validPassword(p){if(typeof p!=='string'||p.length<12||p.length>128)throw new InputError('密码请使用 12–128 个字符。');}
export function passwordHash(p){validPassword(p);const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');}
const dummy=passwordHash(crypto.randomBytes(32).toString('hex'));
export function verifyPassword(p,stored){const [salt,digest]=(stored||dummy).split(':');const expected=Buffer.from(digest,'hex'),actual=crypto.scryptSync(p,salt,64);return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected)&&!!stored;}

// Versioned, transactional migration preserves all measurements and their IDs.
// Unassigned legacy data is never exposed by public registration.
export function migrateAccounts(db){
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,appliedAt TEXT NOT NULL)');
 if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get())return;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,usernameKey TEXT NOT NULL UNIQUE,passwordHash TEXT NOT NULL,createdAt TEXT NOT NULL);
  ALTER TABLE records ADD COLUMN userId TEXT REFERENCES users(id);
  ALTER TABLE sessions ADD COLUMN userId TEXT REFERENCES users(id);
  CREATE INDEX idx_records_user_time ON records(userId,measuredAt);
  CREATE TABLE user_requests(userId TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,response TEXT NOT NULL,createdAt INTEGER NOT NULL,PRIMARY KEY(userId,key));
  CREATE TABLE auth_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);`);
  db.prepare('INSERT INTO schema_migrations VALUES (1,?)').run(new Date().toISOString());
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
