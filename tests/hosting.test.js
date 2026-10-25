import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostingConfig} from '../hosting.js';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

test('Configurazione hosting: origine esatta e dati remoti obbligatori su Render',()=>{
 assert.throws(()=>hostingConfig({RENDER:'true'}),/Turso/);
 assert.throws(()=>hostingConfig({ALLOWED_ORIGINS:'https://example.com/path'}));
 const config=hostingConfig({RENDER:'true',TURSO_DATABASE_URL:'libsql://example.turso.io',TURSO_AUTH_TOKEN:'test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',COOKIE_SECURE:'true',ALLOWED_ORIGINS:'https://logiflow.example',BACKEND_ONLY:'true',TRUST_PROXY:'1'});
 assert.equal(config.backendOnly,true);assert.equal(config.trustProxy,true);
 assert.ok(config.origins.has('https://logiflow.example'));
 assert.ok(!config.origins.has('https://logiflow.example.evil.test'));
});

test('API separata: health DB, cookie sicuro e richieste da Vercel',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'logiflow-hosting-'));
 const child=spawn(process.execPath,['server.js','--production'],{env:{...process.env,PORT:'3201',HOST:'127.0.0.1',DATA_DIR:dir,RENDER:'false',ALLOWED_ORIGINS:'https://logiflow.example',COOKIE_SECURE:'true',TRUST_PROXY:'1',BACKEND_ONLY:'true',ADMIN_PASSWORD:'test-password-123456'},stdio:'pipe'});
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout')),15000);child.stdout.on('data',d=>{if(String(d).includes('disponibile')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error('Server exited'));});});
  const base='http://127.0.0.1:3201';
  let response=await fetch(base+'/api/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,db:true});assert.equal(response.headers.get('cache-control'),'no-store');
  response=await fetch(base+'/api/warmup');assert.equal(response.status,200);
  const body=JSON.stringify({username:'operatore',password:'test-password-123456'});
  response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body});assert.equal(response.status,403);
  response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://logiflow.example','X-Forwarded-Proto':'https'},body});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  response=await fetch(base+'/api/clients',{headers:{Cookie:cookie.split(';')[0],Origin:'https://logiflow.example'}});assert.equal(response.status,200);
  response=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie.split(';')[0],Origin:'https://evil.example'}});assert.equal(response.status,403);
  response=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie.split(';')[0],Origin:'https://logiflow.example'}});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0; Secure/);
  response=await fetch(base+'/api/session',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(response.status,401);
  response=await fetch(base+'/');assert.equal((await response.json()).service,'Logiflow API');
 }finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});

test('Risveglio condiviso, retry HTML transitorio e riuso della connessione',async()=>{
 const source=await readFile(new URL('../public/backend-ready.js',import.meta.url),'utf8');
 let probes=0;const window=new EventTarget();
 const context=vm.createContext({window,Event,AbortController,Date,Promise,Error,
  setTimeout:(fn,ms)=>setTimeout(fn,ms===3000?1:ms),clearTimeout,
  fetch:async()=>{probes++;return probes===1?{ok:true,json:async()=>{throw Error('HTML gateway');}}:{ok:true,json:async()=>({ok:true,db:true})};}});
 vm.runInContext(source,context);
 await Promise.all([window.logiflowBackend.ensureReady(),window.logiflowBackend.ensureReady()]);
 assert.equal(probes,2);assert.equal(window.logiflowBackend.getState(),'ready');
 await window.logiflowBackend.ensureReady();assert.equal(probes,2);
 window.logiflowBackend.invalidate();
 assert.equal(window.logiflowBackend.getState(),'connecting');
 assert.equal(probes,3); // A lost connection starts recovery even without another user action.
 await window.logiflowBackend.ensureReady();assert.equal(probes,3);
 assert.equal(window.logiflowBackend.getState(),'ready');
});
