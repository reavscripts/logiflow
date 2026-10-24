import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {documentStorage} from '../storage.js';
import {openDatabase} from '../database.js';

test('Archivio remoto: bucket privato, upload/download PDF e errori',async()=>{
 const objects=new Map();let isPublic=false;
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-key');
  res.setHeader('Content-Type','application/json');
  if(req.url.includes('/bucket/'))return res.end(JSON.stringify({public:isPublic}));
  const parts=[];for await(const c of req)parts.push(c);const data=Buffer.concat(parts);
  if(req.method==='DELETE'){for(const name of JSON.parse(data).prefixes)objects.delete(name);return res.end('{}');}
  const name=req.url.split('/').at(-1);
  if(req.method==='POST'){objects.set(name,data);return res.end('{}');}
  if(!objects.has(name)){res.statusCode=404;return res.end('{}');}
  res.setHeader('Content-Type','application/pdf');res.end(objects.get(name));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const store=documentStorage('unused',{SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_SERVICE_ROLE_KEY:'test-key'});
  await store.verify();isPublic=true;await assert.rejects(store.verify(),/privato/);isPublic=false;
  const pdf=Buffer.from('%PDF-1.4 test');await store.put('example.pdf',pdf);assert.deepEqual(await store.get('example.pdf'),pdf);
  await assert.rejects(store.get('../secret.pdf'),/Nome/);
  await store.remove('example.pdf');await assert.rejects(store.get('example.pdf'),/404/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Database asincrono: batch, rollback, isolamento contesto e riapertura',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'logiflow-db-')),filename=path.join(dir,'test.sqlite');
 let db=openDatabase(filename,{});
 try{
  await db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY,name TEXT)');
  await db.exec('BEGIN');await db.batch([{sql:'INSERT INTO items(name) VALUES (?)',args:['saved']}]);await db.exec('COMMIT');
  const response=new EventEmitter();
  await new Promise((resolve,reject)=>db.middleware({},response,async()=>{
   try{
    await db.exec('BEGIN');await db.prepare('INSERT INTO items(name) VALUES (?)').run('rollback');
    await new Promise((done,fail)=>db.middleware({},new EventEmitter(),async()=>{try{assert.equal(db.isTransaction,false);await assert.rejects(db.exec('COMMIT'),/No transaction/);done();}catch(e){fail(e);}}));
    assert.equal(db.isTransaction,true);await db.exec('ROLLBACK');resolve();
   }catch(e){reject(e);}
  }));
  db.close();db=openDatabase(filename,{});
  assert.deepEqual((await db.prepare('SELECT name FROM items').all()).map(r=>r.name),['saved']);
 }finally{db.close();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
