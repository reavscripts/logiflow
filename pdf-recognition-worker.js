import { parentPort, workerData } from 'node:worker_threads';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import english from '@tesseract.js-data/eng';
import { findContainers, consolidateCandidates } from './container-recognition.js';
import { fileURLToPath } from 'node:url';
import { recognizeCommunity } from './community-recognition.js';

let pdf, ocr, task;
let currentPage=0, percent=0;
function progress(phase, fraction=0) {
 const pages=pdf?.numPages||0;
 percent=Math.max(percent,pages?Math.min(99,Math.floor(((currentPage-1+fraction)/pages)*100)):0);
 parentPort.postMessage({type:'progress',progress:{phase,page:currentPage,pages,percent}});
}
try {
 progress('opening');
 task=getDocument({wasmUrl:fileURLToPath(new URL('./node_modules/pdfjs-dist/wasm/',import.meta.url)).replaceAll('\\','/'),data:new Uint8Array(workerData),isEvalSupported:false,standardFontDataUrl:fileURLToPath(new URL('./node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/')});pdf=await task.promise;
 if(pdf.numPages>20)throw Error('Il PDF supera 20 pagine. Carica un documento più breve.');
 const candidates=new Set();let scannedPages=0, communityEvidence='';
 for(let n=1;n<=pdf.numPages;n++) {
  currentPage=n;progress('reading');
  const page=await pdf.getPage(n);
  const content=await page.getTextContent();
  const text=content.items.map(item=>item.str||'').join(' ');
  communityEvidence ||= recognizeCommunity(text);
  let found=findContainers(text);
  if(!found.length) {
   progress('preparing',0.1);
   ocr ||= await createWorker('eng',1,{langPath:english.langPath,gzip:true,cacheMethod:'none',logger:message=>{
    if(message.status==='recognizing text')progress('recognizing',0.3+0.65*Math.max(0,Math.min(1,message.progress||0)));
   }});
   const size=page.getViewport({scale:1});
   const scale=Math.min(2.5,2600/Math.max(size.width,size.height));
   const viewport=page.getViewport({scale});
   const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
   progress('rendering',0.2);
   await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
   progress('recognizing',0.3);
   const result=await ocr.recognize(canvas.toBuffer('image/png'));
   communityEvidence ||= recognizeCommunity(result.data.text);
   found=findContainers(result.data.text);scannedPages++;
  }
  found.forEach(code=>candidates.add(code));page.cleanup();
  progress('page-complete',1);
 }
 progress('finalizing',1);
 parentPort.postMessage({candidates:consolidateCandidates([...candidates]),pages:pdf.numPages,ocrPages:scannedPages,community:!!communityEvidence,communityEvidence});
} catch(e) {
 console.error('PDF recognition:',e.message);
 parentPort.postMessage({error:e.name==='PasswordException'?'Il PDF è protetto da password. Carica una copia non protetta.':e.message?.includes('20 pagine')?e.message:'Impossibile leggere il PDF. Verifica che sia valido e non danneggiato.'});
} finally {await ocr?.terminate();await task?.destroy();}
