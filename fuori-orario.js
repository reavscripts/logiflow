import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';

export function romeDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validateWindow(start, end) {
  if (![start, end].every(t => typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) || start < '18:00' || end <= start)
    throw Error('Indica una fascia nello stesso giorno, dalle 18:00 in poi, con fine successiva all’inizio.');
}
export async function generateFuoriOrario(containers, date, start, end) {
  validateWindow(start, end);
  if (!containers.length || containers.length > 200 || new Set(containers).size !== containers.length || containers.some(c => !/^[A-Z]{4}\d{7}$/.test(c))) throw Error('Seleziona da 1 a 200 contenitori distinti.');
  const displayDate = date.split('-').reverse().join('/');
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The supplied two-page form is preserved as a high-resolution background.
  // Replaced fields are covered before writing the current values.
  for (let n = 1; n <= 2; n++) {
    const page = doc.addPage([595.22, 842]);
    const image = await doc.embedPng(await fs.readFile(new URL(`./assets/a77-template-${n}.png`, import.meta.url)));
    page.drawImage(image, { x: 0, y: 0, width: 595.22, height: 842 });
    if (n === 1) {
      page.drawRectangle({ x: 56, y: 547, width: 200, height: 15, color: rgb(1, 1, 1) });
      page.drawText(`ORE ${start.replace(':', '.')} ALLE ORE ${end.replace(':', '.')} DEL ${displayDate}`, { x: 56.7, y: 550.8, size: 9, font: times });
      page.drawRectangle({ x: 83, y: 296, width: 55, height: 15, color: rgb(1, 1, 1) });
      page.drawText(displayDate, { x: 84.25, y: 299.5, size: 10.98, font: times });
    }
  }
  const perPage = 28, count = Math.ceil(containers.length / perPage);
  for (let offset = 0; offset < containers.length; offset += perPage) {
    const page = doc.addPage([595.22, 842]);
    const text = (value, x, y, size = 11, face = font) => page.drawText(value, { x, y, size, font: face });
    text('FUORI ORARIO', 48, 790, 20, bold);
    text('Elenco contenitori - allegato al modello A77', 48, 766, 12);
    text(`Porto di Salerno | ${displayDate} | dalle ${start} alle ${end}`, 48, 741);
    text('Richiedente: VITALE S.R.L. - P.IVA IT04600780656', 48, 720, 10);
    text(`Totale contenitori: ${containers.length}`, 48, 699, 10);
    const rows = containers.slice(offset, offset + perPage);
    page.drawRectangle({ x: 48, y: 663, width: 499, height: 23, color: rgb(.92, .95, .91) });
    text('N.', 60, 671, 10, bold); text('CONTENITORE', 112, 671, 10, bold);
    rows.forEach((code, i) => {
      const y = 648 - i * 19;
      text(String(offset + i + 1), 60, y); text(code, 112, y, 11, bold);
      page.drawLine({ start: { x: 48, y: y - 6 }, end: { x: 547, y: y - 6 }, thickness: .4, color: rgb(.8, .83, .8) });
    });
    text('Elenco predisposto dall’operatore per la presentazione alla dogana.', 48, 78, 9);
    text('Firma / visto: __________________________________', 48, 57, 10);
    text(`Elenco ${offset / perPage + 1} / ${count}`, 467, 35, 9);
  }
  return Buffer.from(await doc.save());
}
