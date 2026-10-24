import React, {useEffect, useState} from 'react';
import {LoaderCircle, ServerOff} from 'lucide-react';
import './backend-status.css';

export default function BackendStatus() {
  const [status,setStatus]=useState(window.logiflowBackend?.getState() || 'ready');
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{
    const update=()=>setStatus(window.logiflowBackend?.getState() || 'ready');
    window.addEventListener('backend-state',update); update();
    return ()=>window.removeEventListener('backend-state',update);
  },[]);
  useEffect(()=>{
    setSeconds(0);
    if(status!=='connecting')return;
    const started=Date.now();
    const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);
    return ()=>clearInterval(timer);
  },[status]);
  if(status==='ready')return null;
  const connecting=status==='connecting';
  return <section className={'server-notice '+(connecting?'is-connecting':'is-offline')} aria-label="Stato del server">
    <div className="server-notice-icon" aria-hidden="true">{connecting?<LoaderCircle className="spin" size={27}/>:<ServerOff size={27}/>}</div>
    <div className="server-notice-copy" role="status" aria-live="polite">
      <strong>{connecting?'Avvio del server in corso…':'Il server non è ancora disponibile'}</strong>
      <p>{connecting?'Stiamo riattivando il collegamento. Dopo un periodo di inattività può essere necessario circa un minuto. Attendi senza ricaricare la pagina.':'Il collegamento non è riuscito. Controlla la connessione e riprova tra qualche istante.'}</p>
    </div>
    {connecting?<span className="server-notice-time" aria-live="off">In attesa · {seconds}s</span>:<button type="button" className="server-notice-retry" onClick={()=>window.logiflowBackend.ensureReady().catch(()=>{})}>Riprova connessione</button>}
  </section>;
}
