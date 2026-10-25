import React, {useState} from 'react';
import {Upload,FileText,Check,ArrowUpRight,LoaderCircle} from 'lucide-react';

const scanPhases={uploading:'Caricamento PDF',opening:'Apertura PDF',reading:'Lettura del testo',preparing:'Preparazione della scansione',rendering:'Preparazione immagine della pagina',recognizing:'Riconoscimento del testo nella scansione',
 'page-complete':'Pagina elaborata',finalizing:'Verifica dei risultati',complete:'Analisi completata',error:'Analisi interrotta'};

export default function OperationEditor({initial,clients,close,done,api,Modal}) {
 const [item,setItem]=useState({...initial}),[savedItem,setSavedItem]=useState({...initial});
 const [docs,setDocs]=useState([]),[files,setFiles]=useState([]),[category,setCategory]=useState('Bolletta doganale');
 const [busy,setBusy]=useState(false),[analyzing,setAnalyzing]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [containerText,setContainerText]=useState((initial.containers||[initial.container]).filter(Boolean).join('\n')),[reference,setReference]=useState('');
 const [scanProgress,setScanProgress]=useState(null);
 const progressRun=React.useRef(null);
 React.useEffect(()=>()=>{if(progressRun.current){const run=progressRun.current;run.active=false;clearTimeout(run.timer);run.controller.abort();void api(`/analyze-pdf/${run.id}`,{method:'DELETE',keepalive:true}).catch(()=>{});}},[]);
 const [manual,setManual]=useState(false),[selectedPdf,setSelectedPdf]=useState(null),[elapsed,setElapsed]=useState(0);
 React.useEffect(()=>{if(!analyzing)return;setElapsed(0);const start=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);return ()=>clearInterval(timer);},[analyzing]);
 const containers=containerText.toUpperCase().split(/[\s,;]+/).filter(Boolean);
 const multi=containers.length>1;
 const a88Required=multi&&!item.community;
 const codeSignature=[...containers].sort().join(',');
 const listSaved=codeSignature===[...(savedItem.containers||[savedItem.container])].sort().join(',');
 const a88Available=docs.some(d=>d.category==='A88'&&d.a88_signature===codeSignature);
 const [source,setSource]=useState(null),[candidates,setCandidates]=useState([]),[verified,setVerified]=useState(false),[dragging,setDragging]=useState(false);
 const customer=clients.find(c=>String(c.id)===String(item.client_id));
 const currentBox=item.deposited&&savedItem.deposited&&String(item.client_id)===String(savedItem.client_id)?savedItem.box:customer?.box||'';
 const change=(key,value)=>{setItem(s=>({...s,[key]:value}));setMessage('');};
 const load=async id=>setDocs(await api(`/dossiers/${id}/documents`));
 React.useEffect(()=>{if(initial.id)load(initial.id).catch(e=>setError(e.message));},[initial.id]);
 async function analyze(selected,skipRecognition=manual) {
  if(busy||analyzing)return;
  setError('');setMessage('');setSource(null);setCandidates([]);setVerified(false);setContainerText('');change('container','');
  if(selected.length!==1){setError('Seleziona un solo PDF per creare l’operazione.');return;}
  const file=selected[0];
  if(!file.name.toLowerCase().endsWith('.pdf')||file.size>20*1024*1024){setError('Carica un PDF di massimo 20 MB.');return;}
  setSelectedPdf(file);setAnalyzing(true);setScanProgress({phase:'uploading',page:0,pages:0,percent:0});
  const progressId=crypto.randomUUID();
  const run={active:true,timer:null,id:progressId,controller:new AbortController()};progressRun.current=run;
  const poll=async()=>{
   try{const progress=await api(`/analyze-pdf/${progressId}/progress`,{signal:run.controller.signal});if(run.active)setScanProgress(progress);}catch{/* The upload may still be in transit; its response reports any final error. */}
   if(run.active)run.timer=setTimeout(poll,700);
  };
  run.timer=setTimeout(poll,500);
  try {
   const form=new FormData();form.append('file',file);
   const result=await api(`/analyze-pdf?progressId=${progressId}${skipRecognition?'&manual=1':''}`,{method:'POST',body:form,signal:run.controller.signal});
   if(!run.active)return;
   change('community',!!result.community);setSource({...result,name:file.name});setCandidates(result.candidates);
   setContainerText(result.candidates.join('\n'));if(result.candidates.length)change('container',result.candidates[0]);
  }catch(e){if(run.active)setError(e.message);}finally{if(run.active)setAnalyzing(false);run.active=false;clearTimeout(run.timer);if(progressRun.current===run)progressRun.current=null;}
 }
 async function save(e) {
  e.preventDefault();setError('');setMessage('');
  if(!item.id&&(!source||!verified)){setError('Carica il PDF e verifica il numero contenitore.');return;}
  setBusy(true);
  try {
   const result=await api(item.id?`/dossiers/${item.id}`:'/dossiers',{method:item.id?'PUT':'POST',body:JSON.stringify({...item,containers,importToken:item.id?undefined:source.importToken})});
   const updated={...item,container:containers[0],containers,id:item.id||result.id,box:currentBox};setItem(updated);setSavedItem(updated);setMessage('Operazione e documenti salvati.');done();
   await load(updated.id);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <Modal wide title={item.id?item.container:'Nuovo'} close={close}>
  {!item.id&&<section className="pdf-import">
   <label className={`upload-zone import-zone ${dragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);analyze(Array.from(e.dataTransfer.files));}}>
    {analyzing?<LoaderCircle size={28} className="spin"/>:<Upload size={28}/>}
    <strong>{analyzing?(manual?'Caricamento PDF…':'Lettura del PDF e riconoscimento contenitore…'):'Trascina qui il PDF o seleziona un file'}</strong>
    <span>Riconoscimento automatico del contenitore · PDF fino a 20 MB e 20 pagine</span>
    <input aria-label="PDF da analizzare" type="file" accept=".pdf,application/pdf" disabled={analyzing||busy} onChange={e=>{analyze(Array.from(e.target.files));e.target.value='';}}/>
   </label>
   {analyzing&&<div role="status"><p className="hint">{selectedPdf?.name} · Attesa: {elapsed}s</p><p className="hint">{scanPhases[scanProgress?.phase]||'Caricamento PDF'}{scanProgress?.pages>0?` · Pagina ${scanProgress.page} di ${scanProgress.pages} · ${scanProgress.percent}%`:"…"}</p><progress className="scan-progress" aria-label="Avanzamento analisi PDF" max="100" value={scanProgress?.pages>0?scanProgress.percent:undefined}/><p className="hint">Le scansioni richiedono più tempo. L’analisi può durare fino a circa 2 minuti; al termine potrai verificare i codici.</p>{elapsed>=30&&<p className="hint">Il riconoscimento è ancora in corso. Se non riesce, potrai caricare il PDF senza riconoscimento e inserire i contenitori manualmente.</p>}</div>}
   {!analyzing&&<label className="check-label"><input type="checkbox" checked={manual} disabled={busy} onChange={e=>setManual(e.target.checked)}/>Inserisci i contenitori manualmente (salta il riconoscimento)</label>}
   {!analyzing&&!source&&selectedPdf&&error&&<button type="button" className="secondary full" disabled={busy} onClick={()=>{setManual(true);analyze([selectedPdf],true);}}>Continua con lo stesso PDF e inserisci i codici manualmente</button>}
   {source&&<div className="import-result" role="status"><FileText size={19}/><div><strong>{source.name}</strong><small>{source.pages} pagine lette{source.ocrPages?` · OCR su ${source.ocrPages} pagine`:''} · PDF allegato al salvataggio</small></div></div>}
  </section>}
  {(item.id||source)&&<form onSubmit={save}>
   {source&&!item.id&&<>
    {!candidates.length&&<p className="alert">{source.manual?"PDF caricato. Inserisci tutti i contenitori presenti nel documento e verifica i codici prima di salvare.":"Nessun numero contenitore riconosciuto. Puoi inserire tutti i numeri dal documento oppure caricare una scansione più leggibile."}</p>}
   </>}
   <div className="form-grid"><label>Contenitori in bolla ({containers.length})<textarea required rows={Math.min(6,Math.max(2,containers.length))} value={containerText} placeholder={'HLBU8225693\nCAIU4229738'} onChange={e=>{setContainerText(e.target.value.toUpperCase());setVerified(false);change('deposited',false);}}/><small className="hint">Un codice per riga. Aggiungi o correggi tutti i contenitori della bolla.</small></label>
    <label>Cliente<select required value={item.client_id} onChange={e=>{setItem(s=>({...s,client_id:e.target.value,deposited:false}));setMessage('');}}><option value="">Seleziona cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
   {!item.id&&<label className="check-label verify-code"><input type="checkbox" required checked={verified} onChange={e=>setVerified(e.target.checked)}/>Ho verificato tutti i contenitori sul PDF</label>}
   <div className="check-panel"><label className="check-label"><input type="checkbox" checked={!!item.community} disabled={busy||analyzing} onChange={e=>change('community',e.target.checked)}/>COMUNITARIO</label><p className="hint">Per le operazioni comunitarie/T2L non serve il modulo A88. I contenitori sono esclusi dal conteggio e dai documenti del fuori orario.</p>{source?.communityEvidence&&<p className="hint">Riconosciuto nel PDF: {source.communityEvidence}. Puoi correggere la spunta prima di salvare.</p>}</div>
   <div className="check-panel"><label className="check-label"><input type="checkbox" checked={!!item.deposited} disabled={a88Required&&!a88Available} onChange={e=>change('deposited',e.target.checked)}/>Operazione depositata in cassetta</label></div>
   <div className="form-grid thirds">{[['box','Cassetta cliente','Configura in Clienti'],['binder','Fascicolo cartaceo','Es. 03'],['divider','Separatore','Es. 12']].map(([key,label,placeholder])=><label key={key}>{label}<input value={key==='box'?currentBox:item[key]} readOnly={key==='box'} required={!!item.deposited} maxLength={key==='box'?243:80} placeholder={placeholder} onChange={e=>change(key,e.target.value)}/></label>)}</div>
   <label>Note interne<textarea value={item.notes} maxLength={2000} rows={2} placeholder="Indicazioni per gli operatori" onChange={e=>change('notes',e.target.value)}/></label>
   <div className="save-row"><span className="success" role="status">{message}</span><button className="primary" disabled={busy||analyzing||(!item.id&&!verified)}>{busy?'Salvataggio…':'Salva operazione'}<Check size={17}/></button></div>
  </form>}
  {a88Required&&<section className="a88-panel"><div className="section-title"><h3>Modulo A88</h3><span className={'badge '+(a88Available?'green':'amber')}>{a88Available?'Presente':'Mancante'}</span></div><p className="hint">Richiesto per i {containers.length} contenitori della bolla. Le colonne data uscita e firma restano da compilare al controllo.</p>
   {!item.id||!listSaved?<p className="hint">Salva l’elenco dei contenitori per caricare o generare l’A88.</p>:<><label>Riferimento bolla / svincolo (facoltativo)<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={40} placeholder="Numero o riferimento del documento"/></label><div className="a88-actions"><button type="button" className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/dossiers/'+item.id+'/a88/generate',{method:'POST',body:JSON.stringify({reference})});await load(item.id);done();setMessage('A88 generato e allegato.');}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Elaborazione…':a88Available?'Genera nuovo A88':'Genera A88'}</button><label className="a88-upload">Carica A88 esistente<input aria-label="Carica A88 esistente" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>20*1024*1024){setError('PDF massimo 20 MB.');return;}setBusy(true);setError('');try{const form=new FormData();form.append('file',file);await api('/dossiers/'+item.id+'/a88',{method:'POST',body:form});await load(item.id);done();setMessage('A88 verificato e allegato.');}catch(e){setError(e.message);}finally{setBusy(false);}}}/></label></div></>}
  </section>}
  {item.id&&<section className="documents"><div className="section-title"><h3>Documenti dell’operazione</h3><span className="small-tag">{docs.length} PDF</span></div>
   {docs.map(d=><a className="document" key={d.id} href={`/api/documents/${d.id}`}><FileText size={21}/><span>{d.name}<small>{d.category}{d.category==='A88'&&d.a88_signature!==codeSignature?' · Elenco precedente':''} · {(d.size/1024).toFixed(0)} KB</small></span><ArrowUpRight size={17}/></a>)}
   <label>Tipo di documento<select value={category} onChange={e=>setCategory(e.target.value)}>{['Bolletta doganale','Svincolo','Documento di trasporto','Controllo Guardia di Finanza','Altro'].map(v=><option key={v}>{v}</option>)}</select></label>
   <label className="upload-zone"><Upload size={25}/><strong>Aggiungi altri PDF</strong><span>Fino a 15 file · massimo 20 MB per file</span><input type="file" accept=".pdf,application/pdf" multiple disabled={busy} onChange={e=>setFiles(Array.from(e.target.files))}/></label>
   {!!files.length&&<><p className="hint">{files.map(f=>f.name).join(', ')}</p><button className="secondary full" disabled={busy} onClick={async()=>{setError('');if(files.length>15||files.some(f=>f.size>20*1024*1024)){setError('Seleziona al massimo 15 PDF da 20 MB ciascuno.');return;}setBusy(true);try{const form=new FormData();form.append('category',category);files.forEach(f=>form.append('files',f));await api(`/dossiers/${item.id}/documents`,{method:'POST',body:form});setFiles([]);await load(item.id);done();setMessage('Documenti caricati.');}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Caricamento…':`Carica ${files.length} PDF`}</button></>}
  </section>}
  {error&&<p className="alert" role="alert">{error}</p>}
 </Modal>;
}
