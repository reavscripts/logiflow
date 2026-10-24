import React, {useEffect,useState} from 'react';
import './departures.css';
const stamp=value=>new Date(value).toLocaleString('it-IT',{timeZone:'Europe/Rome'});

export function DepartureActions({result,api,onUpdated}) {
 const [reporter,setReporter]=useState(''),[plate,setPlate]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const retained=!!result.retained_at,canExit=!result.exited_at&&!!result.deposited;
 async function submit(e){
  e.preventDefault();setBusy(true);setError('');
  try {
   await api('/departures',{method:'POST',body:JSON.stringify({container:result.container,reporter,plate,confirmed})});
   setConfirmed(false);
   await onUpdated();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <div className="departure-panel"><h3>Uscita camion e stato bolla</h3>
  <p>{result.exited_at?`Camion uscito · ${stamp(result.exited_at)}`:'Uscita del camion non ancora registrata.'}</p>
  <p><strong>{result.exited_containers} di {result.total_containers} contenitori usciti</strong>{result.bill_complete?' · Bolla completa':' · Bolla da completare'}</p>
  <p>{result.total_containers>1?'Bolla multicontenitore':'Bolla con un solo contenitore'}</p>
  {retained?<p className="departure-success">Bolla trattenuta dalla Guardia di Finanza il {stamp(result.retained_at)}. Non più in cassetta: tutti i contenitori sono usciti.</p>:result.exited_containers>0?<p>Bolla multicontenitore riconsegnata al trasportatore o addetto per le uscite successive. Restano {result.total_containers-result.exited_containers} contenitori da far uscire.</p>:null}
  {canExit&&<form onSubmit={submit}><fieldset disabled={busy}>
   <h3>Registra camion uscito</h3>
   <div className="departure-fields"><label>Nome di chi registra<input required minLength={2} maxLength={100} value={reporter} onChange={e=>setReporter(e.target.value)} autoComplete="name"/></label>
   <label>Targa camion<input required minLength={3} maxLength={20} value={plate} onChange={e=>setPlate(e.target.value.toUpperCase())} placeholder="Es. AB123CD"/></label></div>
   <p className="hint">{result.total_containers-result.exited_containers===1?'Questa è l’ultima uscita della bolla: alla conferma sarà registrata automaticamente come trattenuta dalla GdF e rimossa dalla cassetta.':'La bolla resterà disponibile per gli altri contenitori e sarà trattenuta dalla GdF all’ultima uscita.'}</p>
   <label className="departure-confirm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{`Confermo che il camion con il contenitore ${result.container} è effettivamente uscito dal porto.`}</span></label>
   <button className="primary" disabled={!confirmed||busy}>{busy?'Registrazione…':'Conferma uscita camion'}</button>
   <p className="hint">La data e l’ora vengono registrate al momento della conferma. Il nominativo è dichiarato da chi compila.</p>
  </fieldset></form>}

  {error&&<p className="alert" role="alert">{error}</p>}
 </div>;
}

export default function Departures({api}) {
 const [rows,setRows]=useState([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 async function refresh(){setLoading(true);setError('');try{setRows(await api('/departures'));}catch(e){setError(e.message);}finally{setLoading(false);}}
 useEffect(()=>{refresh();},[]);
 const visible=rows.filter(r=>`${r.container} ${r.plate} ${r.client} ${r.reporter}`.toUpperCase().includes(query.toUpperCase()));
 return <section><div className="section-title"><div><div className="eyebrow">AREA OPERATORE</div><h1>Camion usciti</h1><p className="muted">Registro delle uscite dichiarate dai trasportatori e dagli addetti.</p></div><button className="secondary" onClick={refresh} disabled={loading}>Aggiorna</button></div>
  {error&&<p className="alert" role="alert">{error}</p>}
  <label>Cerca contenitore, targa, cliente o addetto<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
  <div className="departure-log">{visible.map(r=><article key={r.container}><h3>{r.container} · {r.plate}</h3><p>{r.client} · Uscita: {stamp(r.exited_at)}</p><p>Registrata da: {r.reporter}</p><strong>{r.retained_at?`Bolla trattenuta GdF · ${stamp(r.retained_at)}`:'Bolla multicontenitore riconsegnata per le uscite successive'}</strong></article>)}</div>
  {!visible.length&&<p className="muted">{loading?'Caricamento…':'Nessuna uscita trovata.'}</p>}
 </section>;
}
