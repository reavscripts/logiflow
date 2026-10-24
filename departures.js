// Public actions are declarations by the carrier/gate attendant, not customs integrations.

export async function installDepartures(app, db, limit) {
  await db.exec(`CREATE TABLE IF NOT EXISTS departures (

    container TEXT PRIMARY KEY, dossier_id INTEGER NOT NULL REFERENCES dossiers(id),

    plate TEXT NOT NULL, reporter TEXT NOT NULL, exited_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS retained_bills (

    dossier_id INTEGER PRIMARY KEY REFERENCES dossiers(id), retained_at TEXT NOT NULL, reporter TEXT NOT NULL);`);
  await reconcileCompletedBills(db);
  const details = async code => await db.prepare('SELECT d.* FROM dossiers d JOIN operation_containers oc ON oc.dossier_id=d.id WHERE oc.code=?').get(code);
  const reporterFor = value => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name.length < 2 || name.length > 100) throw Error('Inserisci il nome di chi registra (2–100 caratteri).');
    return name;
  };
  app.post('/api/departures', limit, async (req, res) => {
    try {
      await db.exec('BEGIN');
      const code = String(req.body.container || '').trim().toUpperCase(),
        row = await details(code);
      if (!row) return res.status(404).json({
        error: 'Contenitore non trovato.'
      });
      const reporter = reporterFor(req.body.reporter),
        plate = String(req.body.plate || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9 -]{2,19}$/.test(plate)) throw Error('Inserisci una targa valida (3–20 caratteri).');
      if (req.body.confirmed !== true) throw Error('Conferma l’effettiva uscita del camion dal porto.');
      if (await db.prepare('SELECT 1 FROM departures WHERE container=?').get(code)) return res.status(409).json({
        error: 'Uscita già registrata per questo contenitore.'
      });
      if (!row.deposited || (await db.prepare('SELECT 1 FROM retained_bills WHERE dossier_id=?').get(row.id))) throw Error('La bolla non risulta in cassetta. Contatta l’operatore.');
      const now = new Date().toISOString();
      await db.prepare('INSERT INTO departures VALUES (?,?,?,?,?)').run(code, row.id, plate, reporter, now);
      await retainCompletedBill(db, row.id);
      await db.prepare('UPDATE dossiers SET updated=? WHERE id=?').run(now, row.id);
      await db.exec('COMMIT');
      res.status(201).json({
        ok: true
      });
    } catch (e) {
      if (db.isTransaction) await db.exec('ROLLBACK');
      res.status(400).json({
        error: e.message
      });
    }
  });
}
export async function departureState(db, id, code) {
  const total = (await db.prepare('SELECT count(*) AS n FROM operation_containers WHERE dossier_id=?').get(id)).n;
  const exited = (await db.prepare('SELECT count(*) AS n FROM departures WHERE dossier_id=?').get(id)).n;
  const retained = await db.prepare('SELECT retained_at FROM retained_bills WHERE dossier_id=?').get(id);
  const departure = code ? await db.prepare('SELECT exited_at FROM departures WHERE container=? AND dossier_id=?').get(code, id) : null;
  return {
    total_containers: total,
    exited_containers: exited,
    bill_complete: total > 0 && total === exited,
    retained_at: retained?.retained_at || null,
    exited_at: departure?.exited_at || null
  };
}

// Called inside the exit transaction, using the current container list.

async function retainCompletedBill(db, id) {
  const pending = (await db.prepare('SELECT count(*) AS n FROM operation_containers oc LEFT JOIN departures e ON e.container=oc.code AND e.dossier_id=oc.dossier_id WHERE oc.dossier_id=? AND e.container IS NULL').get(id)).n;
  const last = await db.prepare('SELECT e.exited_at,e.reporter FROM departures e JOIN operation_containers oc ON oc.code=e.container AND oc.dossier_id=e.dossier_id WHERE e.dossier_id=? ORDER BY e.exited_at DESC,e.rowid DESC LIMIT 1').get(id);
  if (pending || !last) return;
  await db.prepare('INSERT OR IGNORE INTO retained_bills VALUES (?,?,?)').run(id, last.exited_at, last.reporter);
  await db.prepare('UPDATE dossiers SET deposited=0,updated=CASE WHEN updated<? THEN ? ELSE updated END WHERE id=?').run(last.exited_at, last.exited_at, id);
}

// Upgrade existing exits without changing their original date or reporter.

export async function reconcileCompletedBills(db) {
  await db.exec('BEGIN');
  try {
    await db.prepare(`INSERT OR IGNORE INTO retained_bills(dossier_id,retained_at,reporter)
      SELECT d.id,
        (SELECT e.exited_at FROM departures e WHERE e.dossier_id=d.id ORDER BY e.exited_at DESC,e.rowid DESC LIMIT 1),
        (SELECT e.reporter FROM departures e WHERE e.dossier_id=d.id ORDER BY e.exited_at DESC,e.rowid DESC LIMIT 1)
      FROM dossiers d
      WHERE EXISTS(SELECT 1 FROM operation_containers oc WHERE oc.dossier_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM operation_containers oc LEFT JOIN departures e ON e.container=oc.code AND e.dossier_id=oc.dossier_id WHERE oc.dossier_id=d.id AND e.container IS NULL)
      AND NOT EXISTS(SELECT 1 FROM retained_bills r WHERE r.dossier_id=d.id)`).run();
    await db.prepare(`UPDATE dossiers SET deposited=0,
      updated=MAX(updated,(SELECT retained_at FROM retained_bills WHERE dossier_id=dossiers.id))
      WHERE deposited<>0 AND id IN (SELECT dossier_id FROM retained_bills)`).run();
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
