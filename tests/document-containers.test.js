import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectDocumentContainers} from '../document-containers.js';
import {findContainers} from '../container-recognition.js';
import {recognizePdf} from '../pdf-recognition.js';
import {PDFDocument} from 'pdf-lib';

const pages=texts=>texts.map((text,i)=>({page:i+1,text,candidates:findContainers(text)}));
const declaration='Status Registration Document EUROPEAN UNION STATUS CODE T2L MRN 26PT000665C001E1P6';
test('T2L: un contenitore ripetuto per due voci, allegati esclusi',()=>{
 const result=selectDocumentContainers(pages(['CNTS GETU5952028 COME DA T2L ALLEGATO',declaration+' Containers GETU5952028 Containers GETU5952028','Bill of lading GESU6950788 TRDU1026513 GETU5952028']));
 assert.deepEqual(result.candidates,['GETU5952028']);assert.deepEqual(result.containerSourcePages,[2]);
 assert.deepEqual(result.excludedCandidates,['GESU6950788','TRDU1026513']);
});
test('T2L multipagina: conserva tutti i contenitori dichiarati e le continuazioni collegate',()=>{
 const result=selectDocumentContainers(pages([declaration+' GETU5952028','Status Registration Document MRN 26PT000665C001E1P6 GESU6950788','Lista spedizione TRDU1026513']));
 assert.deepEqual(result.candidates,['GETU5952028','GESU6950788']);assert.deepEqual(result.containerSourcePages,[1,2]);
});
test('Una semplice menzione T2L non identifica la dichiarazione; avvisa della verifica',()=>{
 const result=selectDocumentContainers(pages(['COME DA T2L ALLEGATO GETU5952028','GESU6950788']));
 assert.deepEqual(result.candidates,['GETU5952028','GESU6950788']);assert.ok(result.selectionWarning);
});
test('T2L illeggibile: non sostituisce la bolla con i codici degli allegati',()=>{
 const result=selectDocumentContainers(pages([declaration,'Lista spedizione GESU6950788']));
 assert.deepEqual(result.candidates,[]);assert.ok(result.selectionWarning);
});
test('PDF ordinario e A88 conservano i contenitori di tutte le pagine',()=>{
 const result=selectDocumentContainers(pages(['A88 GETU5952028','GESU6950788']));
 assert.deepEqual(result.candidates,['GETU5952028','GESU6950788']);assert.equal(result.selectionWarning,'');
});
test('Analisi PDF: usa la dichiarazione anche quando segue gli allegati',async()=>{
 const pdf=await PDFDocument.create();
 for(const text of ['Bill of lading GESU6950788 TRDU1026513',declaration+'\nContainers GETU5952028\nContainers GETU5952028'])pdf.addPage().drawText(text,{x:25,y:700,size:10});
 const result=await recognizePdf(await pdf.save());
 assert.deepEqual(result.candidates,['GETU5952028']);assert.equal(result.community,true);assert.deepEqual(result.containerSourcePages,[2]);assert.equal(result.excludedCandidates.length,2);
});
