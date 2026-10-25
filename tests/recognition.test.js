import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {recognizePdf} from '../pdf-recognition.js';
import {recognizeCommunity} from '../community-recognition.js';
import {findContainers} from '../container-recognition.js';

test('Riconoscimento: separatori, duplicati e confini del codice',()=>{
 assert.deepEqual(findContainers('CHSU 8170740 CHSU8170740 MSCU-1234567'),['CHSU8170740','MSCU1234567']);
 assert.deepEqual(findContainers('XCHSU8170740 CHSU81707401 fattura 1234567'),[]);
});
test('PDF testuale: più numeri, senza OCR',async()=>{
 const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);
 doc.addPage().drawText('T2L Container CHSU8170740 / MSCU1234567',{x:40,y:600,size:20,font});
 const result=await recognizePdf(await doc.save());assert.deepEqual(result.candidates,['CHSU8170740','MSCU1234567']);assert.equal(result.ocrPages,0);assert.equal(result.community,true);assert.equal(result.communityEvidence,'T2L');
});
test('PDF scansionato: numero rilevato tramite OCR locale',async()=>{
 const canvas=createCanvas(1600,700);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,700);ctx.fillStyle='black';ctx.font='60px Arial';ctx.fillText('T2L CONTAINER',90,180);ctx.font='80px Arial';ctx.fillText('CHSU8170740',90,320);
 const doc=await PDFDocument.create();const img=await doc.embedPng(canvas.toBuffer('image/png'));doc.addPage([800,350]).drawImage(img,{x:0,y:0,width:800,height:350});
 const result=await recognizePdf(await doc.save());assert.ok(result.candidates.includes('CHSU8170740'));assert.equal(result.ocrPages,1);assert.equal(result.community,true);
});
test('PDF senza contenitore e file non valido',async()=>{
 const doc=await PDFDocument.create();doc.addPage().drawText('Documento senza codice contenitore',{x:40,y:500,size:20});
 const result=await recognizePdf(await doc.save());assert.deepEqual(result.candidates,[]);
 await assert.rejects(recognizePdf(Buffer.from('%PDF-not valid')),/Impossibile leggere/);
});

test('Comunitario: segnali espliciti e assenza di falsi positivi geografici',()=>{
 for(const text of ['T2L','T 2 L','T2LF','COME DA T2L ALLEGATO','merce CEE','merci comunitarie','importazione comunitaria','esportazione comunitaria']) assert.ok(recognizeCommunity(text),text);
 for(const text of ['T1','T2','XT2L123','merce non comunitaria','merci extracomunitarie','Italia Francia UE','operazione non comunitaria','']) assert.equal(recognizeCommunity(text),'',text);
});
