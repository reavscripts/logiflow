import express from 'express';
import { hostingConfig } from './hosting.js';
const hosting = hostingConfig();
import { installDepartures, departureState } from './departures.js';
import { generateA88 } from './a88.js';
import { generateFuoriOrario, romeDate, validateWindow } from './fuori-orario.js';
import { recognizePdf } from './pdf-recognition.js';
import { PDFDocument } from 'pdf-lib';
import multer from 'multer';
import { openDatabase } from './database.js';
import { documentStorage } from './storage.js';
import {pdfHash, installDocumentHashes, rejectDuplicatePdf, duplicateHashError, duplicateHashMessage} from './document-hashes.js';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(path.join(dir, 'uploads'), {
  recursive: true
});
const db = openDatabase(path.join(dir, 'logiflow.sqlite'));
const storage = documentStorage(path.join(dir, 'uploads'));
await storage.verify();
// A timed-out remote COMMIT may already have succeeded. Never delete a PDF
// unless a fresh database read confirms that no saved document references it.
async function cleanupStored(name) {
  try {
    if (!(await db.prepare('SELECT id FROM documents WHERE stored=?').get(name))) await storage.remove(name);
  } catch {
    console.error('Pulizia documento rinviata: stato remoto non verificabile.');
  }
}
await db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);

CREATE TABLE IF NOT EXISTS dossiers(id INTEGER PRIMARY KEY, container TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id), released INTEGER NOT NULL DEFAULT 0, deposited INTEGER NOT NULL DEFAULT 0, box TEXT NOT NULL DEFAULT '', binder TEXT NOT NULL DEFAULT '', divider TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, dossier_id INTEGER NOT NULL REFERENCES dossiers(id), name TEXT NOT NULL, stored TEXT NOT NULL, category TEXT NOT NULL, size INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
if (!(await db.prepare('PRAGMA table_info(clients)').all()).some(column => column.name === 'box')) {
  await db.exec("ALTER TABLE clients ADD COLUMN box TEXT NOT NULL DEFAULT ''");
}
if (!(await db.prepare('PRAGMA table_info(clients)').all()).some(column => column.name === 'box_name')) {
  await db.exec("ALTER TABLE clients ADD COLUMN box_name TEXT NOT NULL DEFAULT ''; ALTER TABLE clients ADD COLUMN box_location TEXT NOT NULL DEFAULT ''; UPDATE clients SET box_location=box");
}
await db.exec('CREATE TABLE IF NOT EXISTS operation_containers(code TEXT PRIMARY KEY, dossier_id INTEGER NOT NULL REFERENCES dossiers(id))');
await db.exec('INSERT OR IGNORE INTO operation_containers(code,dossier_id) SELECT container,id FROM dossiers');
if (!(await db.prepare('PRAGMA table_info(documents)').all()).some(c => c.name === 'a88_signature')) await db.exec("ALTER TABLE documents ADD COLUMN a88_signature TEXT NOT NULL DEFAULT ''");
if (!(await db.prepare('PRAGMA table_info(dossiers)').all()).some(c => c.name === 'community')) await db.exec('ALTER TABLE dossiers ADD COLUMN community INTEGER NOT NULL DEFAULT 0');
await installDocumentHashes(db, storage);
async function codesFor(id) {
  return (await db.prepare('SELECT code FROM operation_containers WHERE dossier_id=? ORDER BY rowid').all(id)).map(r => r.code);
}
function signature(codes) {
  return [...codes].sort().join(',');
}
function validCodes(body) {
  const codes = (Array.isArray(body.containers) ? body.containers : [body.container]).map(c => String(c || '').trim().toUpperCase());
  if (!codes.length || codes.length > 200 || codes.some(c => !/^[A-Z]{4}\d{7}$/.test(c))) throw Error('Inserisci da 1 a 200 contenitori validi: 4 lettere e 7 cifre.');
  if (new Set(codes).size !== codes.length) throw Error('L’elenco contiene contenitori duplicati.');
  return codes;
}
async function a88Present(id, codes) {
  return codes.length < 2 || !!(await db.prepare("SELECT id FROM documents WHERE dossier_id=? AND category='A88' AND a88_signature=?").get(id, signature(codes)));
}
async function checkA88(body, codes, id, community = false) {
  if (community) return;
  if ((body.deposited === true || body.deposited === 1) && codes.length > 1 && !(await a88Present(id || -1, codes))) throw Error('A88 mancante per questo elenco: salva senza deposito, poi carica o genera il modulo.');
}
async function replaceCodes(id, codes) {
  await db.batch([{
    sql: 'DELETE FROM operation_containers WHERE dossier_id=?',
    args: [id]
  }, ...codes.map(code => ({
    sql: 'INSERT INTO operation_containers(code,dossier_id) VALUES (?,?)',
    args: [code, id]
  }))]);
}
await db.prepare('INSERT OR IGNORE INTO clients(name) VALUES (?)').run('VITALE');
await db.prepare('INSERT OR IGNORE INTO clients(name) VALUES (?)').run('RV TRUCK');
if (!(await db.prepare("SELECT value FROM settings WHERE key='password'").get())) {
  if (process.env.RENDER === 'true' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16)) throw Error('Imposta ADMIN_PASSWORD con almeno 16 caratteri per il primo avvio.');
  const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  await db.prepare('INSERT INTO settings VALUES (?,?)').run('password', `${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
  if (!process.env.ADMIN_PASSWORD) {
    fs.writeFileSync(path.join(dir, 'accesso-operatore.txt'), `Utente: operatore\nPassword: ${password}\n`, {
      mode: 0o600
    });
    console.log('Credenziali iniziali salvate in data/accesso-operatore.txt');
  }
}
const app = express();
app.disable('x-powered-by');
app.use(db.middleware);
if (hosting.trustProxy) app.set('trust proxy', 1);
app.use(express.json({
  limit: '100kb'
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
});
const sessions = new Map();
const attempts = new Map();
const imports = new Map();
const analysisProgress = new Map();
let analyzing = false;
setInterval(() => {
  for (const [key, value] of analysisProgress) if (value.until < Date.now() || !sessions.has(value.owner)) analysisProgress.delete(key);
  for (const [key, value] of imports) if (value.until < Date.now() || !sessions.has(value.owner)) imports.delete(key);
}, 60000).unref();
function limit(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || entry.until < now) {
    entry = {
      count: 0,
      until: now + 60000
    };
    attempts.set(key, entry);
  }
  if (++entry.count > 30) return res.status(429).json({
    error: 'Troppe richieste. Riprova tra un minuto.'
  });
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  for (const [k, v] of sessions) if (v < now) sessions.delete(k);
}, 60000).unref();
function auth(req, res, next) {
  const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('session='))?.slice(8);
  if (!token || (sessions.get(token) || 0) < Date.now()) return res.status(401).json({
    error: 'Accedi come operatore.'
  });
  req.token = token;
  next();
}
function origin(req, res, next) {
  if (req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}` && !hosting.origins.has(req.headers.origin)) return res.status(403).json({
    error: 'Origine non consentita.'
  });
  next();
}
app.use('/api', origin);
app.get(['/api/health', '/api/warmup'], async (req, res) => {
  try {
    await db.prepare('SELECT 1').get();
    res.json({
      ok: true,
      db: true
    });
  } catch {
    res.status(503).json({
      ok: false,
      db: false
    });
  }
});
app.post('/api/login', limit, async (req, res) => {
  const [salt, hash] = (await db.prepare("SELECT value FROM settings WHERE key='password'").get()).value.split(':');
  const password = String(req.body.password || '').slice(0, 256);
  if (req.body.username !== 'operatore' || !timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'))) return res.status(401).json({
    error: 'Credenziali non valide.'
  });
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  res.json({
    ok: true
  });
});
app.post('/api/logout', (req, res) => {
  const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('session='))?.slice(8);
  sessions.delete(token);
  res.setHeader('Set-Cookie', `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  res.json({
    ok: true
  });
});
app.get('/api/session', auth, (req, res) => res.json({
  ok: true
}));
await installDepartures(app, db, limit);
app.get('/api/search', limit, async (req, res) => {
  const container = String(req.query.container || '').trim().toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(container)) return res.status(400).json({
    error: 'Inserisci 4 lettere e 7 cifre, ad esempio MSCU1234567.'
  });
  const row = await db.prepare('SELECT d.id,oc.code AS container,d.deposited,d.box,d.binder,d.divider,d.updated FROM dossiers d JOIN operation_containers oc ON oc.dossier_id=d.id WHERE oc.code=?').get(container);
  if (!row) return res.status(404).json({
    error: 'Contenitore non trovato. Verifica il numero o contatta il tuo operatore.'
  });
  Object.assign(row, await departureState(db, row.id, container));
  delete row.id;
  if (!row.deposited) {
    row.box = '';
    row.binder = '';
    row.divider = '';
  }
  res.json(row);
});
app.use('/api', auth);
app.get('/api/departures', async (req, res) => res.json(await db.prepare('SELECT e.*,c.name AS client,r.retained_at FROM departures e JOIN dossiers d ON d.id=e.dossier_id JOIN clients c ON c.id=d.client_id LEFT JOIN retained_bills r ON r.dossier_id=d.id ORDER BY e.exited_at DESC').all()));
await db.exec(`CREATE TABLE IF NOT EXISTS fuori_orario(id INTEGER PRIMARY KEY, date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, containers TEXT NOT NULL, created TEXT NOT NULL, pdf BLOB NOT NULL)`);
app.get('/api/fuori-orario', async (req, res) => res.json({
  today: romeDate(),
  candidates: await db.prepare('SELECT oc.code,c.name AS client FROM operation_containers oc JOIN dossiers d ON d.id=oc.dossier_id JOIN clients c ON c.id=d.client_id WHERE d.community=0 AND NOT EXISTS (SELECT 1 FROM departures e WHERE e.container=oc.code) ORDER BY d.updated DESC,oc.rowid').all(),
  lists: (await db.prepare('SELECT id,date,start,end,containers,created FROM fuori_orario ORDER BY id DESC').all()).map(r => ({
    ...r,
    containers: JSON.parse(r.containers)
  }))
}));
app.post('/api/fuori-orario', async (req, res) => {
  try {
    const codes = validCodes(req.body),
      {
        start,
        end
      } = req.body;
    validateWindow(start, end);
    const placeholders = codes.map(() => '?').join(',');
    const alreadyExited = async () => !!(await db.prepare(`SELECT 1 FROM departures WHERE container IN (${placeholders}) LIMIT 1`).get(...codes));
    const hasCommunity = async () => !!(await db.prepare(`SELECT 1 FROM operation_containers oc JOIN dossiers d ON d.id=oc.dossier_id WHERE d.community=1 AND oc.code IN (${placeholders}) LIMIT 1`).get(...codes));
    const allExist = async () => (await db.prepare(`SELECT count(*) AS n FROM operation_containers WHERE code IN (${placeholders})`).get(...codes)).n === codes.length;
    if (await hasCommunity()) return res.status(409).json({error: 'Un contenitore appartiene a un’operazione comunitaria e non richiede fuori orario. Aggiorna la selezione.'});
    if (await alreadyExited()) return res.status(409).json({
      error: 'Un contenitore selezionato è già uscito dal porto. Aggiorna la selezione.'
    });
    if (!(await allExist())) return res.status(400).json({
      error: 'Un contenitore non è più presente nelle operazioni.'
    });
    const date = romeDate();
    const pdf = await generateFuoriOrario(codes, date, start, end);
    if (romeDate() !== date) return res.status(409).json({
      error: 'È cambiato il giorno durante la generazione. Riprova con la data corrente.'
    });
    await db.exec('BEGIN');
    if (!(await allExist()) || (await alreadyExited()) || (await hasCommunity())) {
      await db.exec('ROLLBACK');
      return res.status(409).json({
        error: 'Le operazioni sono cambiate, un contenitore è comunitario oppure è uscito. Aggiorna la selezione.'
      });
    }
    const result = await db.prepare('INSERT INTO fuori_orario(date,start,end,containers,created,pdf) VALUES (?,?,?,?,?,?)').run(date, start, end, JSON.stringify(codes), new Date().toISOString(), pdf);
    await db.exec('COMMIT');
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      date,
      start,
      end,
      containers: codes
    });
  } catch (e) {
    if (db.isTransaction) await db.exec('ROLLBACK');
    res.status(400).json({
      error: e.message
    });
  }
});
app.get('/api/fuori-orario/:id/pdf', async (req, res) => {
  const row = await db.prepare('SELECT date,pdf FROM fuori_orario WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({
    error: 'Lista non trovata.'
  });
  res.type('pdf').attachment(`Fuori-orario-${row.date}-${req.params.id}.pdf`).send(Buffer.from(row.pdf));
});
app.get('/api/clients', async (req, res) => res.json(await db.prepare('SELECT * FROM clients ORDER BY name').all()));
app.put('/api/clients/:id/box', async (req, res) => {
  const name = String(req.body.box_name || '').trim();
  const location = String(req.body.box_location || '').trim();
  if (!name || !location || name.length > 80 || location.length > 160) return res.status(400).json({
    error: 'Inserisci nome (massimo 80 caratteri) e locazione (massimo 160 caratteri).'
  });
  const box = `${name} · ${location}`;
  const result = await db.prepare('UPDATE clients SET box=?,box_name=?,box_location=? WHERE id=?').run(box, name, location, Number(req.params.id));
  if (!result.changes) return res.status(404).json({
    error: 'Cliente non trovato.'
  });
  res.json({
    ok: true
  });
});
app.post('/api/clients', async (req, res) => {
  const name = String(req.body.name || '').trim().toUpperCase();
  if (!name || name.length > 80) return res.status(400).json({
    error: 'Inserisci un nome cliente (massimo 80 caratteri).'
  });
  try {
    const result = await db.prepare('INSERT INTO clients(name) VALUES (?)').run(name);
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      name
    });
  } catch {
    res.status(409).json({
      error: 'Questo cliente esiste già.'
    });
  }
});
app.get('/api/dossiers', async (req, res) => res.json(await Promise.all((await db.prepare('SELECT d.*, c.name AS client, (SELECT count(*) FROM documents WHERE dossier_id=d.id) AS documents FROM dossiers d JOIN clients c ON c.id=d.client_id ORDER BY updated DESC').all()).map(async d => {
  const containers = await codesFor(d.id);
  return {
    ...d,
    ...(await departureState(db, d.id)),
    departed_codes: (await db.prepare('SELECT container FROM departures WHERE dossier_id=?').all(d.id)).map(r => r.container),
    containers,
    a88_required: containers.length > 1 && !d.community,
    a88_available: await a88Present(d.id, containers)
  };
}))));
async function fields(body, existing) {
  const container = validCodes(body)[0];
  if (!/^[A-Z]{4}\d{7}$/.test(container)) throw Error('Numero contenitore non valido: servono 4 lettere e 7 cifre.');
  const client = Number(body.client_id);
  const customer = await db.prepare('SELECT id,box FROM clients WHERE id=?').get(client);
  if (!customer) throw Error('Seleziona un cliente valido.');
  const released = existing?.released || 0;
  const deposited = body.deposited === true || body.deposited === 1 ? 1 : 0;
  const box = existing?.deposited && existing.client_id === client && deposited ? existing.box : customer.box;
  const pos = [box, ...['binder', 'divider'].map(k => String(body[k] || '').trim().slice(0, 80))];
  if (deposited && pos.some(p => !p)) throw Error('Per confermare il deposito serve la posizione completa.');
  if (body.community !== undefined && ![true, false, 0, 1].includes(body.community)) throw Error('Valore COMUNITARIO non valido.');
  const community = body.community === undefined ? (existing?.community || 0) : Number(!!body.community);
  return [container, client, released, deposited, community, ...pos, String(body.notes || '').slice(0, 2000), new Date().toISOString()];
}
app.post('/api/dossiers', async (req, res) => {
  let stored;
  try {
    const codes = validCodes(req.body);
    const source = req.body.importToken ? imports.get(req.body.importToken) : null;
    if (req.body.importToken && (!source || source.owner !== req.token || source.until < Date.now())) return res.status(400).json({
      error: 'PDF temporaneo scaduto. Caricalo nuovamente.'
    });
    const values = await fields({...req.body, community: req.body.community ?? source?.community ?? false});
    await checkA88(req.body, codes, undefined, values[4]);
    if (source) {
      await rejectDuplicatePdf(db, source.sha256);
      stored = randomBytes(24).toString('hex') + '.pdf';
      await storage.put(stored, source.buffer);
    }
    await db.exec('BEGIN');
    const result = await db.prepare('INSERT INTO dossiers(container,client_id,released,deposited,community,box,binder,divider,notes,updated) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...values);
    const id = Number(result.lastInsertRowid);
    await replaceCodes(id, codes);
    if (source) {
      await rejectDuplicatePdf(db, source.sha256);
      await db.prepare('INSERT INTO documents(dossier_id,name,stored,category,size,sha256) VALUES (?,?,?,?,?,?)').run(id, source.name, stored, 'Altro', source.buffer.length, source.sha256);
    }
    await db.exec('COMMIT');
    if (source) imports.delete(req.body.importToken);
    res.status(201).json({
      id
    });
  } catch (e) {
    if (db.isTransaction) await db.exec('ROLLBACK');
    if (stored) await cleanupStored(stored);
    if (duplicateHashError(e)) return res.status(409).json({error: duplicateHashMessage(e)});
    res.status(400).json({
      error: e.message.includes('UNIQUE') ? 'Esiste già un’operazione per questo contenitore. Aprila per aggiungere documenti.' : e.message
    });
  }
});
app.put('/api/dossiers/:id', async (req, res) => {
  try {
    await db.exec('BEGIN');
    const id = Number(req.params.id),
      existing = await db.prepare('SELECT * FROM dossiers WHERE id=?').get(id);
    if (!existing) return res.status(404).json({
      error: 'Operazione non trovata.'
    });
    const codes = validCodes(req.body);
    const hasExits = await db.prepare('SELECT 1 FROM departures WHERE dossier_id=?').get(id);
    if (hasExits && (signature(codes) !== signature(await codesFor(id)) || Number(req.body.client_id) !== existing.client_id)) throw Error('Con uscite registrate non è possibile cambiare contenitori o cliente della bolla.');
    if ((await db.prepare('SELECT 1 FROM retained_bills WHERE dossier_id=?').get(id)) && (req.body.deposited === true || req.body.deposited === 1)) throw Error('La bolla è trattenuta dalla Guardia di Finanza e non può risultare in cassetta.');
    const values = await fields(req.body, existing);
    await checkA88(req.body, codes, id, values[4]);
    await db.prepare('UPDATE dossiers SET container=?,client_id=?,released=?,deposited=?,community=?,box=?,binder=?,divider=?,notes=?,updated=? WHERE id=?').run(...values, id);
    await replaceCodes(id, codes);
    await db.exec('COMMIT');
    res.json({
      ok: true
    });
  } catch (e) {
    if (db.isTransaction) await db.exec('ROLLBACK');
    res.status(400).json({
      error: e.message.includes('UNIQUE') ? 'Un contenitore appartiene già a un’altra operazione.' : e.message
    });
  }
});
app.get('/api/dossiers/:id/documents', async (req, res) => res.json(await db.prepare('SELECT id,name,category,size,a88_signature FROM documents WHERE dossier_id=?').all(Number(req.params.id))));
async function attachA88(id, buffer, name, codes) {
  const hash = pdfHash(buffer);
  await rejectDuplicatePdf(db, hash);
  const stored = randomBytes(24).toString('hex') + '.pdf';
  try {
    await storage.put(stored, buffer);
    await db.exec('BEGIN');
    await rejectDuplicatePdf(db, hash);
    if (signature(await codesFor(id)) !== signature(codes)) throw Error('Elenco contenitori modificato. Riprova.');
    await db.prepare('INSERT INTO documents(dossier_id,name,stored,category,size,a88_signature,sha256) VALUES (?,?,?,?,?,?,?)').run(id, name, stored, 'A88', buffer.length, signature(codes), hash);
    await db.prepare('UPDATE dossiers SET updated=? WHERE id=?').run(new Date().toISOString(), id);
    await db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) await db.exec('ROLLBACK');
    await cleanupStored(stored);
    throw e;
  }
}
app.post('/api/dossiers/:id/a88/generate', async (req, res) => {
  const id = Number(req.params.id),
    codes = await codesFor(id);
  if (codes.length < 2) return res.status(400).json({
    error: 'A88 previsto per operazioni con più contenitori.'
  });
  const reference = String(req.body.reference || '').trim();
  if (reference.length > 40 || /[^\x20-\x7E]/.test(reference)) return res.status(400).json({
    error: 'Riferimento bolla: massimo 40 caratteri, lettere, numeri e simboli standard.'
  });
  try {
    const buffer = await generateA88(codes, reference);
    if (signature(await codesFor(id)) !== signature(codes)) return res.status(409).json({
      error: 'Elenco modificato durante la generazione. Riprova.'
    });
    await attachA88(id, buffer, 'A88-' + codes[0] + '.pdf', codes);
    res.status(201).json({
      ok: true
    });
  } catch (e) {
    if (duplicateHashError(e)) return res.status(409).json({error: duplicateHashMessage(e)});
    res.status(400).json({
      error: e.message
    });
  }
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 15,
    fields: 1
  }
});
app.post('/api/dossiers/:id/a88', upload.single('file'), async (req, res) => {
  const id = Number(req.params.id),
    codes = await codesFor(id);
  if (codes.length < 2) return res.status(400).json({
    error: 'Operazione multipla non trovata.'
  });
  if (!req.file || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({
    error: 'Carica un A88 in formato PDF.'
  });
  if (analyzing) return res.status(429).json({
    error: 'Analisi già in corso. Riprova tra poco.'
  });
  analyzing = true;
  try {
    await rejectDuplicatePdf(db, pdfHash(req.file.buffer));
    const read = await recognizePdf(req.file.buffer);
    if (codes.some(code => !read.candidates.includes(code))) return res.status(400).json({
      error: 'Non sono stati riconosciuti tutti i contenitori nell’A88. Verifica il documento oppure genera un nuovo modulo.'
    });
    if (signature(await codesFor(id)) !== signature(codes)) return res.status(409).json({
      error: 'Elenco modificato. Riprova.'
    });
    await attachA88(id, req.file.buffer, Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200), codes);
    res.status(201).json({
      ok: true
    });
  } catch (e) {
    if (duplicateHashError(e)) return res.status(409).json({error: duplicateHashMessage(e)});
    res.status(400).json({
      error: e.message
    });
  } finally {
    analyzing = false;
  }
});
app.get('/api/analyze-pdf/:id/progress', (req, res) => {
  const entry = analysisProgress.get(req.params.id);
  if (!entry || entry.owner !== req.token || entry.until < Date.now()) return res.status(404).json({error: 'Analisi non disponibile.'});
  res.json(entry.progress);
});
app.delete('/api/analyze-pdf/:id', limit, (req, res) => {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(req.params.id)) return res.status(400).json({error: 'Identificativo analisi non valido.'});
  const entry = analysisProgress.get(req.params.id);
  if (entry && entry.owner !== req.token) return res.status(404).json({error: 'Analisi non disponibile.'});
  if (entry?.controller) entry.controller.abort();
  // Remember cancellation during upload too: a proxy may forward the PDF later.
  if (!entry) {
    for (const [key, value] of analysisProgress) if (value.owner === req.token && !value.controller && value.progress.phase !== 'cancelled') analysisProgress.delete(key);
    analysisProgress.set(req.params.id, {owner: req.token, until: Date.now() + 5 * 60000, progress: {phase: 'cancelled', page: 0, pages: 0, percent: 0}});
  }
  res.json({ok: true});
});
app.post('/api/analyze-pdf', limit, (req, res, next) => {
  if (analyzing && req.query.manual !== '1') return res.status(429).json({
    error: 'È già in corso un’analisi PDF. Riprova tra poco.'
  });
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file || req.file.buffer.subarray(0, 5).toString() !== '%PDF-' || !req.file.originalname.toLowerCase().endsWith('.pdf')) return res.status(400).json({
    error: 'Carica un file PDF valido.'
  });
  if (analyzing && req.query.manual !== '1') return res.status(429).json({
    error: 'È già in corso un’analisi PDF. Riprova tra poco.'
  });
  const progressId = req.query.progressId;
  if (progressId !== undefined && (typeof progressId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(progressId))) return res.status(400).json({error: 'Identificativo analisi non valido.'});
  if (progressId && analysisProgress.has(progressId)) return res.status(409).json({error: 'Identificativo analisi già utilizzato.'});
  const controller = new AbortController();
  const disconnected = () => {if (!res.writableEnded) controller.abort();};
  res.on('close', disconnected);
  if (req.aborted || res.destroyed) controller.abort();
  const report = progress => {
    if (progressId) analysisProgress.set(progressId, {owner: req.token, until: Date.now() + 5 * 60000, progress, controller});
  };
  // Preserve cancellation markers until expiry, including when a new upload starts.
  for (const [key, entry] of analysisProgress) if (entry.owner === req.token && !entry.controller && entry.progress.phase !== 'cancelled') analysisProgress.delete(key);
  report({phase: 'opening', page: 0, pages: 0, percent: 0});
  const manual = req.query.manual === '1';
  if (!manual) analyzing = true;
  try {
    const hash = pdfHash(req.file.buffer);
    await rejectDuplicatePdf(db, hash);
    let result;
    if (manual) {
      const pdf = await PDFDocument.load(req.file.buffer);
      if (pdf.getPageCount() > 20) throw Error('Il PDF supera 20 pagine.');
      result = {candidates: [], pages: pdf.getPageCount(), ocrPages: 0, manual: true};
    } else result = await recognizePdf(req.file.buffer, report, {signal: controller.signal});
    controller.signal.throwIfAborted();
    for (const [key, value] of imports) if (value.owner === req.token || value.until < Date.now()) imports.delete(key);
    if (imports.size >= 10) return res.status(429).json({
      error: 'Troppi PDF in attesa di salvataggio. Riprova tra qualche minuto.'
    });
    const token = randomBytes(24).toString('hex');
    imports.set(token, {
      sha256: hash,
      community: !!result.community,
      owner: req.token,
      buffer: req.file.buffer,
      name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200),
      until: Date.now() + 30 * 60000
    });
    report({phase: 'complete', page: result.pages, pages: result.pages, percent: 100});
    res.json({
      ...result,
      importToken: token
    });
  } catch (e) {
    if (duplicateHashError(e)) return res.status(409).json({error: duplicateHashMessage(e)});
    res.status(400).json({
      error: e.message
    });
  } finally {
    res.off('close', disconnected);
    if (progressId && analysisProgress.get(progressId)?.progress.phase !== 'complete') report({...analysisProgress.get(progressId)?.progress, phase: controller.signal.aborted ? 'cancelled' : 'error'});
    if (progressId) delete analysisProgress.get(progressId)?.controller;
    if (!manual) analyzing = false;
  }
});
app.post('/api/dossiers/:id/documents', upload.array('files', 15), async (req, res) => {
  const id = Number(req.params.id);
  if (req.body.category === 'A88') return res.status(400).json({
    error: 'Usa il caricamento A88 dedicato.'
  });
  if (!(await db.prepare('SELECT id FROM dossiers WHERE id=?').get(id))) return res.status(404).json({
    error: 'Operazione non trovata.'
  });
  if (!req.files?.length || req.files.some(f => f.buffer.subarray(0, 5).toString() !== '%PDF-' || !f.originalname.toLowerCase().endsWith('.pdf'))) return res.status(400).json({
    error: 'Seleziona soltanto file PDF validi.'
  });
  const written = [];
  const hashes = req.files.map(f => pdfHash(f.buffer));
  try {
    if (new Set(hashes).size !== hashes.length) return res.status(409).json({error: 'Hai selezionato più copie dello stesso PDF. Mantieni una sola copia del file.'});
    for (const hash of hashes) await rejectDuplicatePdf(db, hash);
    for (const f of req.files) {
      const stored = randomBytes(24).toString('hex') + '.pdf';
      await storage.put(stored, f.buffer);
      written.push(stored);
    }
    await db.exec('BEGIN');
    for (const hash of hashes) await rejectDuplicatePdf(db, hash);
    await db.batch(req.files.map((f, i) => ({
      sql: 'INSERT INTO documents(dossier_id,name,stored,category,size,sha256) VALUES (?,?,?,?,?,?)',
      args: [id, Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 200), written[i], String(req.body.category || 'Altro').slice(0, 80), f.size, hashes[i]]
    })));
    await db.prepare('UPDATE dossiers SET updated=? WHERE id=?').run(new Date().toISOString(), id);
    await db.exec('COMMIT');
    res.status(201).json({
      ok: true
    });
  } catch (e) {
    if (db.isTransaction) await db.exec('ROLLBACK');
    for (const name of written) await cleanupStored(name);
    if (duplicateHashError(e)) return res.status(409).json({error: duplicateHashMessage(e)});
    throw e;
  }
});
app.get('/api/documents/:id', async (req, res) => {
  const doc = await db.prepare('SELECT * FROM documents WHERE id=?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({
    error: 'Documento non trovato.'
  });
  res.type('pdf').attachment(doc.name).send(await storage.get(doc.stored));
});
app.use('/api', (req, res) => res.status(404).json({
  error: 'Risorsa non trovata.'
}));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({
    error: err instanceof multer.MulterError ? 'Caricamento non riuscito: massimo 15 PDF da 20 MB ciascuno.' : 'Operazione non riuscita. Riprova.'
  });
});
if (hosting.backendOnly) {
  app.get('/', (req, res) => res.json({
    service: 'Logiflow API',
    health: '/api/health'
  }));
} else if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const {
    createServer
  } = await import('vite');
  const vite = await createServer({
    server: {
      middlewareMode: true
    },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Logiflow disponibile su http://localhost:${port}`));
