import React, {useEffect, useState} from 'react';

export default function BackendStatus() {
  const [status,setStatus]=useState(window.logiflowBackend?.getState() || 'ready');
  useEffect(()=>{
    const update=()=>setStatus(window.logiflowBackend?.getState() || 'ready');
    window.addEventListener('backend-state',update); update();
    return ()=>window.removeEventListener('backend-state',update);
  },[]);
  if(status==='ready')return null;
  return <div className="backend-status" role="status" aria-live="polite">
    {status==='connecting'?'Connessione al server in corso. Puoi già inserire il numero del contenitore.':'Il server non risponde ancora.'}
    {status==='offline'&&<button className="text-button" onClick={()=>window.logiflowBackend.ensureReady().catch(()=>{})}>Riprova connessione</button>}
  </div>;
}
