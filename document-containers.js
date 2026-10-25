import { consolidateCandidates } from './container-recognition.js';
import { recognizeCommunity } from './community-recognition.js';

export function selectDocumentContainers(pages) {
 const allCandidates=consolidateCandidates([...new Set(pages.flatMap(p=>p.candidates))]);
 // A mention of an attached T2L on a cover letter is not the declaration itself.
 const declarations=pages.filter(p=>{
  const text=p.text.toUpperCase();
  return recognizeCommunity(text)==='T2L' &&
   (/\bSTATUS\s+REGISTRATION\s+DOCUMENT\b/.test(text) ||
    (/\bSTATUS\s+CODE\b/.test(text)&&/\bMRN\b/.test(text)));
 });
 if(!declarations.length)return {candidates:allCandidates,allCandidates,excludedCandidates:[],containerSourcePages:[],selectionWarning:pages.some(p=>recognizeCommunity(p.text)==='T2L')?'T2L rilevato, ma le pagine della bolla non sono state identificate con certezza. Verifica che i codici proposti appartengano al T2L e non agli allegati.':''};
 // Include recognizable continuation sheets only when they carry the same MRN
 // and the declaration header; never include the shipping list by proximity.
 const mrns=new Set(declarations.flatMap(p=>p.text.toUpperCase().match(/\b\d{2}[A-Z]{2}[A-Z0-9]{14}\b/g)||[]));
 const sources=pages.filter(p=>declarations.includes(p)||(
  /\bSTATUS\s+REGISTRATION\s+DOCUMENT\b/i.test(p.text)&&
  [...mrns].some(mrn=>p.text.toUpperCase().includes(mrn))));
 const candidates=consolidateCandidates([...new Set(sources.flatMap(p=>p.candidates))]);
 const excludedCandidates=allCandidates.filter(code=>!candidates.includes(code));
 return {candidates,allCandidates,excludedCandidates,containerSourcePages:sources.map(p=>p.page),
  selectionWarning:sources.some(p=>!p.candidates.length)?'Non sono stati letti contenitori in una pagina del T2L. Verifica il documento e completa manualmente l’elenco.':''};
}
