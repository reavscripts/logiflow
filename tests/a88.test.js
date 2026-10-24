import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateA88} from '../a88.js';
import {PDFDocument} from 'pdf-lib';
import {recognizePdf} from '../pdf-recognition.js';
import {consolidateCandidates} from '../container-recognition.js';

test('A88 multipagina e codici: nessuna riga persa',async()=>{
 const codes=Array.from({length:21},(_,i)=>'HLBU'+String(i).padStart(7,'0'));
 const buffer=await generateA88(codes,'TEST');const pdf=await PDFDocument.load(buffer);assert.equal(pdf.getPageCount(),2);
 const recognized=await recognizePdf(buffer);assert.deepEqual(recognized.candidates,codes);
});
test('Lettura OCR alternativa incoerente con cifra di controllo',()=>{
 assert.deepEqual(consolidateCandidates(['CATU4229738','HLBU8225693','CAIU4229738']),['HLBU8225693','CAIU4229738']);
 assert.deepEqual(consolidateCandidates(['CATU4229738']),['CATU4229738']);
});
