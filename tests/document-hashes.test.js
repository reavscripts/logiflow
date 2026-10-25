import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../database.js';
import {installDocumentHashes,pdfHash,rejectDuplicatePdf} from '../document-hashes.js';

test('Hash archivio: migrazione ripetibile, duplicati storici conservati e nuovi bloccati',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'logiflow-hash-'));const db=openDatabase(path.join(dir,'test.sqlite'),{});
 try{
  await db.exec(`CREATE TABLE dossiers(id INTEGER PRIMARY KEY,container TEXT);CREATE TABLE documents(id INTEGER PRIMARY KEY,dossier_id INTEGER,name TEXT,stored TEXT);INSERT INTO dossiers VALUES(1,'MSCU1234567');INSERT INTO documents VALUES(1,1,'old.pdf','a.pdf'),(2,1,'copy.pdf','b.pdf');`);
  const bytes=Buffer.from('%PDF-1.4 identical');let reads=0;
  const storage={get:async()=>{reads++;return bytes;}};
  await installDocumentHashes(db,storage);await installDocumentHashes(db,storage);
  assert.equal(reads,2);assert.equal((await db.prepare('SELECT count(*) AS n FROM documents').get()).n,2);
  assert.equal((await db.prepare('SELECT sha256 FROM documents WHERE id=1').get()).sha256,pdfHash(bytes));
  await assert.rejects(rejectDuplicatePdf(db,pdfHash(bytes)),e=>e.status===409&&e.message.includes('MSCU1234567'));
  await assert.rejects(db.prepare('INSERT INTO documents(dossier_id,name,stored,sha256) VALUES(?,?,?,?)').run(1,'renamed.pdf','c.pdf',pdfHash(bytes)),/DOCUMENT_HASH_DUPLICATE/);
  await rejectDuplicatePdf(db,pdfHash(Buffer.from('different')));
 }finally{db.close();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

