import React, { useEffect, useState } from 'react';
import { Clock, Download } from 'lucide-react';
import './fuori-orario.css';

const dateLabel = date => date.split('-').reverse().join('/');
export default function FuoriOrario({ api }) {
  const [selected, setSelected] = useState([]), [query, setQuery] = useState('');
  const [start, setStart] = useState('18:00'), [end, setEnd] = useState('21:00');
  const [archive, setArchive] = useState([]), [today, setToday] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState(null);
  const [rows, setRows] = useState([]), [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    const data = await api('/fuori-orario');
    setToday(data.today); setArchive(data.lists); setRows(data.candidates); setLoaded(true);
    const eligible = new Set(data.candidates.map(r => r.code));
    setSelected(old => old.filter(code => eligible.has(code)));
  };
  useEffect(() => {
    const update = () => refresh().catch(e => setError(e.message));
    update();
    const timer = setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  const visible = rows.filter(r => `${r.code} ${r.client}`.toUpperCase().includes(query.trim().toUpperCase()));
  const toggle = code => setSelected(old => old.includes(code) ? old.filter(c => c !== code) : [...old, code]);
  const generate = async e => {
    e.preventDefault(); setBusy(true); setError(''); setCreated(null);
    try {
      const list = await api('/fuori-orario', { method: 'POST', body: JSON.stringify({ containers: selected, start, end }) });
      setCreated(list); setSelected([]);
      await refresh();
    } catch (e) { setError(e.message); await refresh().catch(() => {}); } finally { setBusy(false); }
  };
  return <section className="fuori-orario">
    <div className="section-title"><div><div className="eyebrow">AREA OPERATORE</div><h1>FUORI ORARIO</h1><p className="muted">Prepara il modello A77 e la lista giornaliera per la dogana.</p></div><Clock size={30}/></div>
    <p className="fo-notice">Modello intestato a <strong>VITALE S.R.L. · P.IVA IT04600780656</strong>, Porto di Salerno. Il PDF include le due pagine del modello e l’elenco selezionato. La generazione predispone i documenti per la presentazione; il visto doganale resta da acquisire.</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {created && <div className="fo-success" role="status"><strong>Documenti generati per il {dateLabel(created.date)} · {created.containers.length} contenitori</strong><a className="primary" href={`/api/fuori-orario/${created.id}/pdf`} download><Download size={17}/>Scarica A77 + elenco</a></div>}
    <form onSubmit={generate} className="table-card fo-form">
      <fieldset disabled={busy}>
        <div className="fo-settings"><div><span className="mobile-field-label">Data di presentazione</span><strong>{today ? dateLabel(today) : 'Caricamento…'}</strong><small>Data corrente italiana, aggiornata alla generazione.</small></div><label>Dalle<input type="time" min="18:00" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Alle<input type="time" min={start} required value={end} onChange={e => setEnd(e.target.value)}/></label></div>
        <label>Cerca contenitore o cliente<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Es. MSCU1234567 oppure VITALE"/></label>
        <div className="fo-actions"><strong>{selected.length} selezionati su {rows.length}</strong><button type="button" className="text-button" onClick={() => setSelected(old => [...new Set([...old, ...visible.map(r => r.code)])])}>Seleziona i risultati ({visible.length})</button><button type="button" className="text-button" onClick={() => setSelected([])}>Svuota selezione</button></div>
        <div className="fo-containers">{visible.map(r => <label key={r.code} className={selected.includes(r.code) ? 'chosen' : ''}><input type="checkbox" checked={selected.includes(r.code)} onChange={() => toggle(r.code)}/><span><strong>{r.code}</strong><small>{r.client}</small></span></label>)}{!visible.length && <p className="muted">{!loaded ? 'Caricamento contenitori…' : rows.length ? 'Nessun risultato per questa ricerca.' : 'Nessun contenitore ancora da uscire disponibile.'}</p>}</div>
        <p className="hint">Sono selezionabili solo i contenitori non ancora usciti. La lista si aggiorna automaticamente. Massimo 200 contenitori per lista.</p>
        <button className="primary" disabled={!selected.length || selected.length > 200 || !today || end <= start || start < '18:00'}>{busy ? 'Generazione in corso…' : `Genera A77 + elenco (${selected.length})`}</button>
      </fieldset>
    </form>
    <h2 className="fo-archive-title">Liste generate</h2><p className="muted">Ogni documento conserva la data, la fascia e i contenitori della sua generazione.</p>
    <div className="fo-archive">{archive.map(list => <article key={list.id}><div><strong>{dateLabel(list.date)} · {list.start}–{list.end}</strong><p>{list.containers.length} contenitori · Lista #{list.id}</p><details><summary>Vedi contenitori</summary><p>{list.containers.join(', ')}</p></details></div><a className="secondary" href={`/api/fuori-orario/${list.id}/pdf`} download><Download size={17}/>Scarica PDF</a></article>)}{!archive.length && <p className="muted">Nessuna lista generata.</p>}</div>
  </section>;
}
