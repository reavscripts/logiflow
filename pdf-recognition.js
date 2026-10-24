import { Worker } from 'node:worker_threads';

export function recognizePdf(buffer) {
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./pdf-recognition-worker.js',import.meta.url),{workerData:buffer});
  const timer=setTimeout(()=>{worker.terminate();reject(Error('Analisi scaduta. Prova con un PDF più breve o una scansione più leggibile.'));},100000);
  worker.once('message',result=>{clearTimeout(timer);result.error?reject(Error(result.error)):resolve(result);});
  worker.once('error',error=>{clearTimeout(timer);reject(error);});
  worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Analisi PDF interrotta. Riprova.'));});
 });
}
