import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fromBuffer} from 'yauzl';
import {openDatabase} from '../database.js';
import {installArchive} from '../archive.js';
import {pdfHash} from '../document-hashes.js';

function unzip(buffer){return new Promise((resolve,reject)=>fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
 if(error)return reject(error);const files=new Map();zip.on('error',reject);zip.on('end',()=>resolve(files));
 zip.on('entry',entry=>zip.openReadStream(entry,(err,stream)=>{if(err)return reject(err);const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('error',reject);stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});}));zip.readEntry();
}));}

test('Archivio ZIP verificato, autorizzazione, modifiche concorrenti e pulizia recuperabile',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'logiflow-archive-test-'));const db=openDatabase(path.join(directory,'db.sqlite'),{});
 const original=Buffer.from('%PDF-1.4 original'),outside=Buffer.from('%PDF-1.4 fuori orario');
 const objects=new Map([['original.pdf',original]]);let failRemove=true,purged=0;
 const storage={get:async name=>{if(!objects.has(name))throw Error('File mancante');return objects.get(name);},remove:async name=>{if(failRemove)throw Error('Storage offline');objects.delete(name);}};
 let server,archive;
 try{
  await db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT,box TEXT);INSERT INTO clients VALUES(1,'Cliente','Cassetta A');
  CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO settings VALUES('password','secret');
  CREATE TABLE dossiers(id INTEGER PRIMARY KEY,container TEXT,client_id INTEGER REFERENCES clients(id),notes TEXT,community INTEGER,deposited INTEGER,box TEXT,binder TEXT,divider TEXT);
  INSERT INTO dossiers VALUES(1,'MSCU1234567',1,'<script>test</script>',1,1,'A','1','2');
  CREATE TABLE documents(id INTEGER PRIMARY KEY,dossier_id INTEGER REFERENCES dossiers(id),name TEXT,stored TEXT,category TEXT,size INTEGER,sha256 TEXT);
  CREATE TABLE operation_containers(code TEXT PRIMARY KEY,dossier_id INTEGER REFERENCES dossiers(id));INSERT INTO operation_containers VALUES('MSCU1234567',1);
  CREATE TABLE departures(container TEXT PRIMARY KEY,dossier_id INTEGER REFERENCES dossiers(id),plate TEXT,reporter TEXT,exited_at TEXT);INSERT INTO departures VALUES('MSCU1234567',1,'AB123CD','Mario','2026-10-25');
  CREATE TABLE retained_bills(dossier_id INTEGER PRIMARY KEY REFERENCES dossiers(id),retained_at TEXT);INSERT INTO retained_bills VALUES(1,'2026-10-25');
  CREATE TABLE fuori_orario(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,containers TEXT,created TEXT,pdf BLOB);`);
  await db.prepare('INSERT INTO documents VALUES(1,1,?,?,?,?,?)').run('../original.pdf','original.pdf','Bolla',original.length,pdfHash(original));
  await db.prepare('INSERT INTO fuori_orario VALUES(1,?,?,?,?,?,?)').run('2026-10-25','18:00','21:00','["MSCU1234567"]','2026-10-25',outside);
  const app=express();app.use(express.json());app.use(db.middleware);app.use((req,res,next)=>{req.token=req.headers.cookie;if(!req.token)return res.sendStatus(401);next();});
  archive=await installArchive(app,db,storage,{onPurged:()=>purged++});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/archives`;
  const call=(suffix='',method='GET',body,owner='owner')=>fetch(base+suffix,{method,headers:{Cookie:owner,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const wait=async id=>{for(let i=0;i<200;i++){const j=await (await call('/'+id)).json();if(j.state!=='building')return j;await new Promise(r=>setTimeout(r,20));}throw Error('Export timeout');};
  assert.equal((await fetch(base,{method:'POST'})).status,401);
  // Missing storage data prevents a downloadable/cleanable archive.
  objects.delete('original.pdf');let r=await call('','POST');assert.equal(r.status,202);let bad=await wait((await r.json()).id);assert.equal(bad.state,'error');
  r=await call('/'+bad.id+'/purge','POST',{confirmation:'ELIMINA'});assert.equal(r.status,409);assert.equal((await db.prepare('SELECT count(*) AS n FROM dossiers').get()).n,1);
  objects.set('original.pdf',original);
  r=await call('','POST');const stale=await wait((await r.json()).id);assert.equal(stale.state,'ready');
  assert.equal((await call('/'+stale.id,'GET',undefined,'other')).status,404);
  assert.equal((await call('/'+stale.id+'/zip','GET',undefined,'other')).status,404);
  r=await call('/'+stale.id+'/purge','POST',{confirmation:'ELIMINA',sha256:stale.sha256});assert.equal(r.status,409);
  r=await call('/'+stale.id+'/zip');assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(pdfHash(bytes),stale.sha256);
  const files=await unzip(bytes);const data=JSON.parse(files.get('dati.json'));assert.equal(data.settings,undefined);assert.equal(data.departures[0].plate,'AB123CD');assert.equal(data.retained_bills.length,1);
  assert.deepEqual(files.get(data.documents[0].archivePath),original);assert.deepEqual(files.get(data.fuori_orario[0].archivePath),outside);
  assert.ok(!files.get('APRI-ARCHIVIO.html').toString().includes('<script>'));assert.ok([...files.keys()].every(k=>!k.split('/').includes('..')));
  await db.prepare('UPDATE dossiers SET notes=? WHERE id=1').run('Modifica dopo export');
  r=await call('/'+stale.id+'/purge','POST',{confirmation:'ELIMINA',sha256:stale.sha256});assert.equal(r.status,409);assert.equal(objects.size,1);
  r=await call('','POST');const fresh=await wait((await r.json()).id);assert.equal(fresh.state,'ready');await (await call('/'+fresh.id+'/zip')).arrayBuffer();
  const confirm={confirmation:'ELIMINA',sha256:fresh.sha256};
  assert.equal((await call('/'+fresh.id+'/purge','POST',confirm,'other')).status,404);
  r=await call('/'+fresh.id+'/purge','POST',confirm);assert.equal(r.status,200);
  for(const table of ['dossiers','documents','operation_containers','departures','retained_bills','fuori_orario'])assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n,0,table);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM clients').get()).n,1);assert.equal((await db.prepare('SELECT value FROM settings').get()).value,'secret');assert.equal(purged,1);
  // Failed storage removal remains queued; retry must not remove new operations.
  for(let i=0;i<100;i++){if(!(await (await call('/'+fresh.id)).json()).cleaning)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal((await db.prepare('SELECT count(*) AS n FROM archive_pending_files').get()).n,1);
  await db.prepare('INSERT INTO dossiers(id,container,client_id) VALUES(2,?,1)').run('MSCU7654321');failRemove=false;
  r=await call('/'+fresh.id+'/purge','POST',confirm);assert.equal(r.status,200);
  for(let i=0;i<100;i++){if(!(await (await call('/'+fresh.id)).json()).cleaning)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(objects.size,0);assert.equal((await db.prepare('SELECT count(*) AS n FROM archive_pending_files').get()).n,0);assert.equal((await db.prepare('SELECT count(*) AS n FROM dossiers').get()).n,1);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await archive?.dispose();db.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
