// Require explicit document evidence, never infer status from countries or clients.
export function recognizeCommunity(text) {
  const normalized = String(text || '').normalize('NFKC').toUpperCase();
  if (/\bT[\s.-]*2[\s.-]*L(?:[\s.-]*F)?\b/.test(normalized)) return 'T2L';
  if (/\bMERC[EI]\s+(?:CEE|COMUNITARI[AE])\b/.test(normalized)) return 'Merce comunitaria';
  if (/\b(?:IMPORTAZIONE|ESPORTAZIONE|OPERAZIONE)\s+COMUNITARIA\b/.test(normalized)) return 'Operazione comunitaria';
  return '';
}
