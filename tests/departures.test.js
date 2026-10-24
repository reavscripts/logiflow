import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Uscite pubbliche, bolla multipla completa, rimozione e riservatezza registro',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'logiflow-departures-'));
 const server=spawn(process.execPath,['server.js','--production'],{env:{...process.env,PORT:'3199',DATA_DIR:dir,ADMIN_PASSWORD:'test'},stdio:'pipe'});
 try {
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Timeout')),15000);server.stdout.on('data',d=>{if(String(d).includes('disponibile')){clearTimeout(t);resolve();}});server.on('error',reject);});
  const base='http://127.0.0.1:3199/api';let cookie='';
  const call=(url,body,priv=false,method=body?'POST':'GET')=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...(priv?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  let r=await call('/login',{username:'operatore',password:'test'});cookie=r.headers.get('set-cookie').split(';')[0];
  const clients=await (await call('/clients',null,true)).json(),client_id=clients[0].id;
  await call(`/clients/${client_id}/box`,{box_name:'A',box_location:'Ingresso'},true,'PUT');
  const item={containers:['MSCU1234567','HLBU8225693'],client_id,binder:'1',divider:'2',deposited:false};
  r=await call('/dossiers',item,true);const {id}=await r.json();
  const exit=container=>({container,plate:'AB123CD',reporter:'Addetto test',confirmed:true});
  assert.equal((await call('/departures',exit(item.containers[0]))).status,400);
  await call(`/dossiers/${id}/a88/generate`,{},true);
  assert.equal((await call(`/dossiers/${id}`,{...item,deposited:true},true,'PUT')).status,200);
  assert.equal((await call('/departures',{...exit(item.containers[0]),confirmed:false})).status,400);
  assert.equal((await call('/departures',{...exit(item.containers[0]),plate:''})).status,400);
  assert.equal((await call('/departures',exit(item.containers[0]))).status,201);
  assert.equal((await call('/departures',exit(item.containers[0]))).status,409);
  const outside=containers=>({containers,start:'18:00',end:'21:00'});
  let outsideState=await (await call('/fuori-orario',null,true)).json();
  assert.ok(!outsideState.candidates.some(r=>r.code===item.containers[0]));
  assert.ok(outsideState.candidates.some(r=>r.code===item.containers[1]));
  assert.equal((await call('/fuori-orario',outside([item.containers[0]]),true)).status,409);
  assert.equal((await call('/fuori-orario',outside(item.containers),true)).status,409);
  assert.equal((await call('/fuori-orario',outside([item.containers[1]]),true)).status,201);

  let state=await (await call('/search?container='+item.containers[0])).json();
  const partialRows=await (await call('/dossiers',null,true)).json();assert.deepEqual(partialRows.find(d=>d.id===id).departed_codes,[item.containers[0]]);assert.equal(partialRows.find(d=>d.id===id).bill_complete,false);
  assert.equal(state.exited_containers,1);assert.equal(state.bill_complete,false);assert.equal(state.deposited,1);assert.ok(state.exited_at);assert.equal(state.plate,undefined);assert.equal(state.reporter,undefined);
  assert.equal((await call(`/dossiers/${id}`,{...item,containers:[item.containers[0]]},true,'PUT')).status,400);
  assert.equal((await call('/departures',exit(item.containers[1]))).status,201);
  state=await (await call('/search?container='+item.containers[1])).json();assert.equal(state.bill_complete,true);assert.equal(state.deposited,0);assert.ok(state.retained_at);assert.equal(state.retained_at,state.exited_at);
  for(const code of item.containers){state=await (await call('/search?container='+code)).json();assert.equal(state.deposited,0);assert.equal(state.box,'');assert.ok(state.retained_at);}
  assert.equal((await call(`/dossiers/${id}`,{...item,deposited:true},true,'PUT')).status,400);
  assert.equal((await call('/departures')).status,401);
  const log=await (await call('/departures',null,true)).json();assert.equal(log.length,2);assert.equal(log[0].plate,'AB123CD');assert.ok(log[0].retained_at);
  outsideState=await (await call('/fuori-orario',null,true)).json();assert.equal(outsideState.candidates.length,0);assert.equal(outsideState.lists.length,1);assert.deepEqual(outsideState.lists[0].containers,[item.containers[1]]);
  // A single-container bill completes with its first exit.
  const single={...item,containers:['CAIU4229738'],deposited:true};await call('/dossiers',single,true);
  assert.equal((await call('/departures',exit(single.containers[0]))).status,201);
  state=await (await call('/search?container='+single.containers[0])).json();assert.equal(state.bill_complete,true);assert.equal(state.total_containers,1);
  const rows=await (await call('/dossiers',null,true)).json(), completed=rows.find(d=>d.container===single.containers[0]);assert.equal(completed.bill_complete,true);assert.equal(completed.deposited,0);assert.ok(completed.retained_at);assert.deepEqual(completed.departed_codes,single.containers);
 }finally{server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});


test('Riallineamento bolle complete esistenti, parziali e riavvio ripetuto',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {reconcileCompletedBills}=await import('../departures.js');
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(`CREATE TABLE dossiers(id INTEGER PRIMARY KEY,deposited INTEGER,updated TEXT);
   CREATE TABLE operation_containers(code TEXT,dossier_id INTEGER);
   CREATE TABLE departures(container TEXT,dossier_id INTEGER,exited_at TEXT,reporter TEXT);
   CREATE TABLE retained_bills(dossier_id INTEGER PRIMARY KEY,retained_at TEXT,reporter TEXT);
   INSERT INTO dossiers VALUES(1,1,'2026-10-24'),(2,1,'2026-10-24'),(3,1,'2026-10-24');
   INSERT INTO operation_containers VALUES('A',1),('B',2),('C',2),('D',3),('E',3);
   INSERT INTO departures VALUES('A',1,'2026-10-24T10:00:00Z','Uno'),('B',2,'2026-10-24T11:00:00Z','Due'),('D',3,'2026-10-24T12:00:00Z','Tre'),('E',3,'2026-10-24T13:00:00Z','Quattro');`);
  await reconcileCompletedBills(db);await reconcileCompletedBills(db);
  assert.deepEqual(db.prepare('SELECT deposited FROM dossiers ORDER BY id').all().map(r=>r.deposited),[0,1,0]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM retained_bills').get().n,2);
  const retained=db.prepare('SELECT * FROM retained_bills WHERE dossier_id=3').get();
  assert.equal(retained.retained_at,'2026-10-24T13:00:00Z');assert.equal(retained.reporter,'Quattro');
 }finally{db.close();}
});
