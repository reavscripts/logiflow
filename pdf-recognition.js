import { Worker } from 'node:worker_threads';

export function recognizePdf(buffer, onProgress = () => {}, {signal} = {}) {
 return new Promise((resolve,reject)=>{
  const cancelled=()=>new DOMException('Analisi PDF annullata.','AbortError');
  if(signal?.aborted){reject(cancelled());return;}
  const worker=new Worker(new URL('./pdf-recognition-worker.js',import.meta.url),{workerData:buffer});
  let settled=false;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const finish=(error,result)=>{
   if(settled)return;settled=true;cleanup();error?reject(error):resolve(result);
  };
  // Release the caller's analysis slot only after the worker has actually stopped.
  const stop=async error=>{
   if(settled)return;settled=true;cleanup();
   try{await worker.terminate();}finally{reject(error);}
  };
  const abort=()=>{void stop(cancelled());};
  const timer=setTimeout(()=>{void stop(Error('Analisi scaduta. Prova con un PDF più breve o una scansione più leggibile.'));},100000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.on('message',result=>{
   if(settled)return;
   if(result.type==='progress'){onProgress(result.progress);return;}
   finish(result.error?Error(result.error):null,result);
  });
  worker.once('error',error=>finish(error));
  worker.once('exit',()=>finish(Error('Analisi PDF interrotta. Riprova.')));
 });
}
