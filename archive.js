import {ZipFile} from 'yazl';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pdfHash} from './document-hashes.js';

const tables=['clients','dossiers','operation_containers','documents','departures','retained_bills','fuori_orario'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName=value=>String(value).normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'documento.pdf';
const conflict=message=>Object.assign(Error(message),{status:409});

export async function installArchive(app,db,storage,{onPurged=()=>{}}={}) {
 await db.exec(`CREATE TABLE IF NOT EXISTS archive_revision(id INTEGER PRIMARY KEY, value INTEGER NOT NULL);
 INSERT OR IGNORE INTO archive_revision VALUES(1,0);
 CREATE TABLE IF NOT EXISTS archive_purges(id TEXT PRIMARY KEY,created TEXT NOT NULL,sha256 TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS archive_pending_files(stored TEXT PRIMARY KEY);`);
 for(const table of tables)for(const action of ['INSERT','UPDATE','DELETE'])await db.exec(`CREATE TRIGGER IF NOT EXISTS archive_${table}_${action} AFTER ${action} ON ${table} BEGIN UPDATE archive_revision SET value=value+1 WHERE id=1; END;`);
 const revision=async()=>Number((await db.prepare('SELECT value FROM archive_revision WHERE id=1').get()).value);
 const jobs=new Map();let building=false,purging=false,cleaning=false;
 async function cleanFiles(){
  if(cleaning)return;cleaning=true;
  try{
   for(const row of await db.prepare('SELECT stored FROM archive_pending_files').all()){
    try{
     if(await db.prepare('SELECT id FROM documents WHERE stored=?').get(row.stored))continue;
     await storage.remove(row.stored);
     await db.prepare('DELETE FROM archive_pending_files WHERE stored=?').run(row.stored);
    }catch{ /* Persistent queue retries on the next cleanup or server start. */ }
   }
  }finally{cleaning=false;}
 }
 await cleanFiles();
 const timer=setInterval(()=>{for(const [id,job] of jobs)if(job.expires<Date.now()&&job.state!=='building'&&!job.downloads){jobs.delete(id);void rm(job.directory,{recursive:true,force:true}).catch(()=>{});}},60000);timer.unref();
 const counts=s=>({operations:s.dossiers.length,containers:s.operation_containers.length,documents:s.documents.length,outsideLists:s.fuori_orario.length,departures:s.departures.length});
 const publicJob=j=>({id:j.id,state:j.state,counts:j.counts,processed:j.processed,total:j.total,bytes:j.bytes,sha256:j.sha256,downloaded:j.downloaded,error:j.error,expires:new Date(j.expires).toISOString(),filename:j.filename});
 function owned(req){const job=jobs.get(req.params.id);if(!job||job.owner!==req.token||job.expires<Date.now())throw Object.assign(Error('Esportazione scaduta o non disponibile. Creane una nuova.'),{status:404});return job;}
 async function build(job,snapshot){
  try{
   const zip=new ZipFile();
   zip.on('error',error=>zip.outputStream.destroy(error));
   const writing=pipeline(zip.outputStream,createWriteStream(job.file,{flags:'wx'}));
   // Attach a rejection handler immediately; lazy reads can fail before end().
   writing.catch(()=>{});
   const operations=new Map(snapshot.dossiers.map(d=>[d.id,d]));
   for(const doc of snapshot.documents){
    doc.archivePath=`operazioni/${doc.dossier_id}-${safeName(operations.get(doc.dossier_id)?.container)}/${doc.id}-${safeName(doc.name)}`;
    zip.addReadStreamLazy(doc.archivePath,{compress:false},callback=>{
     storage.get(doc.stored).then(buffer=>{
      if(pdfHash(buffer)!==doc.sha256)throw Error(`Il PDF «${doc.name}» non corrisponde all’hash registrato. Esportazione interrotta.`);
      job.processed++;callback(null,Readable.from([buffer]));
     }).catch(callback);
    });
   }
   for(const list of snapshot.fuori_orario){
    list.archivePath=`fuori-orario/${list.id}-${safeName(list.date)}.pdf`;
    zip.addReadStreamLazy(list.archivePath,{compress:false},callback=>{
     db.prepare('SELECT pdf FROM fuori_orario WHERE id=?').get(list.id).then(row=>{
      if(!row)throw Error('Una lista fuori orario è cambiata. Ripeti l’esportazione.');
      job.processed++;callback(null,Readable.from([Buffer.from(row.pdf)]));
     }).catch(callback);
    });
   }
   zip.addBuffer(Buffer.from(JSON.stringify({format:'logiflow-archive-v1',created:job.created,...snapshot},null,2)),'dati.json');
   const rows=snapshot.dossiers.map(d=>{
    const codes=snapshot.operation_containers.filter(c=>c.dossier_id===d.id).map(c=>c.code).join(', ');
    const client=snapshot.clients.find(c=>c.id===d.client_id)?.name||'';
    const files=snapshot.documents.filter(doc=>doc.dossier_id===d.id).map(doc=>`<a href="${escape(doc.archivePath)}">${escape(doc.name)} (${escape(doc.category)})</a>`).join('<br>');
    const exits=snapshot.departures.filter(e=>e.dossier_id===d.id).map(e=>`${e.container} · ${e.plate} · ${e.reporter} · ${e.exited_at}`).join('\n');
    return `<tr><td>${d.id}</td><td>${escape(codes)}</td><td>${escape(client)}</td><td>${d.community?'COMUNITARIO':'Ordinaria'}<br>${d.deposited?'In cassetta':'Non in cassetta'}<br>${escape([d.box,d.binder,d.divider].filter(Boolean).join(' / '))}</td><td>${escape(d.notes)}</td><td>${files}</td><td>${escape(exits)}</td></tr>`;
   }).join('');
   zip.addBuffer(Buffer.from(`<!doctype html><html lang="it"><meta charset="utf-8"><title>Archivio LogiFlow</title><style>body{font:14px system-ui;margin:32px;color:#213840}table{border-collapse:collapse;width:100%}td,th{padding:12px;border:1px solid #ccd5d7;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#245c78}</style><h1>Archivio operazioni LogiFlow</h1><p>Esportato il ${escape(job.created)} · ${job.counts.operations} operazioni · ${job.counts.documents} allegati.</p><p>Estrarre lo ZIP prima di aprire i documenti. Il file dati.json conserva tutti i dati, incluse uscite e bolle trattenute.</p><table><tr><th>ID</th><th>Contenitori</th><th>Cliente</th><th>Stato e posizione</th><th>Note</th><th>Documenti</th><th>Uscite</th></tr>${rows}</table><h2>Fuori orario</h2>${snapshot.fuori_orario.map(l=>`<p><a href="${escape(l.archivePath)}">${escape(l.date)} · ${escape(l.start)}–${escape(l.end)} · Lista ${l.id}</a></p>`).join('')}</html>`),'APRI-ARCHIVIO.html');
   zip.end();await writing;
   if(await revision()!==job.revision)throw Error('I dati sono cambiati durante l’esportazione. Crea un nuovo archivio.');
   const hash=createHash('sha256');for await(const chunk of createReadStream(job.file))hash.update(chunk);
   job.sha256=hash.digest('hex');job.bytes=(await stat(job.file)).size;job.state='ready';
  }catch(e){job.state='error';job.error=e.message;await rm(job.file,{force:true}).catch(()=>{});}finally{building=false;}
 }
 app.post('/api/archives',async(req,res)=>{
  if(building||purging)return res.status(409).json({error:'Esportazione o pulizia già in corso.'});
  if(jobs.size>=3)return res.status(409).json({error:'Sono già presenti tre esportazioni temporanee. Attendi la scadenza prima di crearne altre.'});
  building=true;let directory;
  try{
   await db.exec('BEGIN');const snapshot={};const version=await revision();
   for(const table of tables)snapshot[table]=await db.prepare(table==='fuori_orario'?'SELECT id,date,start,end,containers,created FROM fuori_orario ORDER BY id':`SELECT * FROM ${table} ORDER BY ${table==='operation_containers'?'code':table==='departures'?'container':table==='retained_bills'?'dossier_id':'id'}`).all();
   await db.exec('COMMIT');
   if(!snapshot.dossiers.length&&!snapshot.fuori_orario.length)throw Error('Non ci sono operazioni o liste da esportare.');
   directory=await mkdtemp(path.join(os.tmpdir(),'logiflow-export-'));
   const id=randomBytes(24).toString('hex'),created=new Date().toISOString();
   const job={id,owner:req.token,directory,file:path.join(directory,'archive.zip'),filename:`Logiflow-${created.replace(/[:.]/g,'-')}.zip`,created,revision:version,counts:counts(snapshot),processed:0,total:snapshot.documents.length+snapshot.fuori_orario.length,state:'building',downloaded:false,downloads:0,expires:Date.now()+60*60000};
   jobs.set(id,job);void build(job,snapshot);res.status(202).json(publicJob(job));
  }catch(e){building=false;if(db.isTransaction)await db.exec('ROLLBACK');if(directory)await rm(directory,{recursive:true,force:true});res.status(400).json({error:e.message});}
 });
 app.get('/api/archives/:id',async(req,res)=>{try{const job=owned(req);res.json({...publicJob(job),pendingFiles:job.state==='purged'?Number((await db.prepare('SELECT count(*) AS n FROM archive_pending_files').get()).n):undefined,cleaning});}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.get('/api/archives/:id/zip',async(req,res)=>{
  try{const job=owned(req);if(!['ready','purged'].includes(job.state))throw conflict('Archivio non ancora pronto.');job.downloads++;
   res.download(job.file,job.filename,error=>{job.downloads--;if(!error)job.downloaded=true;else if(!res.headersSent)res.status(500).json({error:'Download non riuscito. Riprova.'});});
  }catch(e){res.status(e.status||400).json({error:e.message});}
 });
 app.post('/api/archives/:id/purge',async(req,res)=>{
  let job,ownsPurge=false;
  try{
   job=owned(req);
   if(req.body.confirmation!=='ELIMINA' || req.body.sha256!==job.sha256 || !job.sha256 || !job.downloaded)throw conflict('Scarica e verifica lo ZIP, poi conferma la pulizia scrivendo ELIMINA.');
   if(building||purging)throw conflict('Esportazione o pulizia già in corso.');
   if(!['ready','purged'].includes(job.state))throw conflict('Archivio non disponibile per la pulizia.');
   purging=true;ownsPurge=true;
   await db.exec('BEGIN');
   if(!(await db.prepare('SELECT id FROM archive_purges WHERE id=?').get(job.id))){
    if(await revision()!==job.revision)throw conflict('Le operazioni sono cambiate dopo l’esportazione. Nessun dato eliminato: crea e scarica un nuovo archivio.');
    await db.exec('INSERT OR IGNORE INTO archive_pending_files(stored) SELECT stored FROM documents');
    for(const table of ['departures','retained_bills','documents','operation_containers','dossiers','fuori_orario'])await db.exec(`DELETE FROM ${table}`);
    await db.prepare('INSERT INTO archive_purges(id,created,sha256) VALUES (?,?,?)').run(job.id,new Date().toISOString(),job.sha256);
   }
   await db.exec('COMMIT');job.state='purged';onPurged();
   // The queue is persisted in the same transaction. An uncertain COMMIT never
   // leads to deleting objects before the database confirms the purge.
   void cleanFiles().catch(()=>{});
   const pending=Number((await db.prepare('SELECT count(*) AS n FROM archive_pending_files').get()).n);
   res.json({ok:true,pendingFiles:pending});
  }catch(e){if(db.isTransaction)await db.exec('ROLLBACK');res.status(e.status||400).json({error:e.message});}
  finally{if(ownsPurge)purging=false;}
 });
 return {dispose:async()=>{clearInterval(timer);for(const job of jobs.values())await rm(job.directory,{recursive:true,force:true});}};
}
