import {createHash} from 'node:crypto';

export const pdfHash=buffer=>createHash('sha256').update(buffer).digest('hex');

export async function installDocumentHashes(db,storage) {
 if (!(await db.prepare('PRAGMA table_info(documents)').all()).some(c=>c.name==='sha256')) await db.exec("ALTER TABLE documents ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''");
 // Existing duplicates remain intact; every archived file participates in checks.
 for(const doc of await db.prepare("SELECT id,stored FROM documents WHERE sha256='' ORDER BY id").all()) {
  const hash=pdfHash(await storage.get(doc.stored));
  await db.prepare("UPDATE documents SET sha256=? WHERE id=? AND sha256=''").run(hash,doc.id);
 }
 await db.exec(`CREATE INDEX IF NOT EXISTS documents_sha256 ON documents(sha256);
 CREATE TRIGGER IF NOT EXISTS documents_unique_hash BEFORE INSERT ON documents
 WHEN NEW.sha256<>'' AND EXISTS(SELECT 1 FROM documents WHERE sha256=NEW.sha256)
 BEGIN SELECT RAISE(ABORT, 'DOCUMENT_HASH_DUPLICATE'); END;`);
}

export async function rejectDuplicatePdf(db,hash) {
 const existing=await db.prepare('SELECT d.name,d.dossier_id,o.container FROM documents d JOIN dossiers o ON o.id=d.dossier_id WHERE d.sha256=? ORDER BY d.id LIMIT 1').get(hash);
 if(existing) {
  const error=Error(`Questo PDF è già presente come «${existing.name}» nell’operazione #${existing.dossier_id} (contenitore ${existing.container}).`);
  error.status=409;throw error;
 }
}

export const duplicateHashError=error=>error.status===409||error.message.includes('DOCUMENT_HASH_DUPLICATE');
export const duplicateHashMessage=error=>error.status===409?error.message:'Questo PDF è già presente nel gestionale. Aggiorna le operazioni prima di riprovare.';
