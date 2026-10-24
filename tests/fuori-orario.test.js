import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFuoriOrario, romeDate, validateWindow } from '../fuori-orario.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test('Data italiana anche oltre la mezzanotte e cambio ora', () => {
  assert.equal(romeDate(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(romeDate(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  for (const pair of [['17:59','21:00'],['18:00','18:00'],['21:00','18:00'],['18:00','24:00'],['18:00','09:00'],['18','21:00']]) assert.throws(() => validateWindow(...pair));
  validateWindow('18:00','21:00');
});
test('A77 con due date aggiornate ed elenco completo su più pagine', async () => {
  const codes = Array.from({ length: 57 }, (_, i) => 'MSCU' + String(i).padStart(7, '0'));
  const loading = getDocument({ data: new Uint8Array(await generateFuoriOrario(codes, '2026-10-24', '18:30', '22:15')), useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    assert.equal(pdf.numPages, 5);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map(x => x.str).join(' '));
    assert.equal(pages[0].match(/24\/10\/2026/g).length, 2);
    assert.match(pages[0], /18.30 ALLE ORE 22.15/);
    assert.ok(!pages.join(' ').includes('23/10/2026'));
    for (const code of codes) assert.equal(pages.join(' ').split(code).length - 1, 1);
    await assert.rejects(generateFuoriOrario([], '2026-10-24', '18:00', '21:00'));
  } finally { await loading.destroy(); }
});
