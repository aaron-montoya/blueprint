import { jsPDF } from 'jspdf';
import { connectionRows } from '../model/connections';
import { WIRE_COLORS } from '../model/format';
import type { DiagramContent } from '../store/convert';
import { diagramBounds, legendEntries, renderDiagram, titleRows } from './render';

/**
 * jsPDF's built-in fonts only cover WinAnsi. Map the symbols our part and
 * pin names use to plain equivalents so nothing prints as garbage.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u03a9/g, ' ohm')
    .replace(/\u23da\s*/g, '')
    .replace(/[^\x20-\x7e\u00a0-\u00ff\u2014\u2022]/g, '?');
}

/**
 * One landscape Letter page: the diagram scaled to fit, with the title block
 * and pin-color legend along the bottom as real (crisp) text.
 */
export async function renderPdf(content: DiagramContent): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const footerH = 104;
  const areaW = W - 2 * M;
  const areaH = H - 2 * M - footerH - 10;

  // Aim for ~250 dpi at the printed size.
  const probe = diagramBounds(content);
  const printScale = Math.min(areaW / probe.width, areaH / probe.height);
  const printedLongPt = Math.max(probe.width, probe.height) * printScale;
  const img = await renderDiagram(content, (printedLongPt / 72) * 250);

  const w = img.width * printScale;
  const h = img.height * printScale;
  doc.addImage(img.dataUrl, 'PNG', M + (areaW - w) / 2, M + (areaH - h) / 2, w, h, undefined, 'FAST');
  doc.setDrawColor(200);
  doc.setLineWidth(0.5);
  doc.rect(M, M, areaW, areaH);

  // Title block
  const fy = H - M - footerH;
  doc.setDrawColor(30);
  doc.setLineWidth(1.2);
  doc.rect(M, fy, 380, footerH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(doc.splitTextToSize(pdfText(content.title.heading), 360)[0] ?? '', M + 10, fy + 18);
  const rows = titleRows(content.title);
  rows.forEach((r, i) => {
    const col = i < 3 ? 0 : 1;
    const row = i < 3 ? i : i - 3;
    const x = M + 10 + col * 190;
    const y = fy + 40 + row * 22;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(r.label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(doc.splitTextToSize(pdfText(r.value) || '—', 120)[0] ?? '', x + 58, y);
  });

  // Legend
  const lx = M + 395;
  doc.setDrawColor(150);
  doc.setLineWidth(0.6);
  doc.rect(lx, fy, 290, footerH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Pin colors', lx + 10, fy + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  legendEntries().forEach((e, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = lx + 10 + col * 140;
    const y = fy + 30 + row * 22;
    doc.setFillColor(e.color);
    doc.setDrawColor(40);
    doc.rect(x, y, 10, 10, 'FD');
    doc.text(e.label, x + 16, y + 8.5);
  });

  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(`Blueprint · printed ${new Date().toLocaleDateString()}`, W - M, H - M + 12, { align: 'right' });
  addConnectionPages(doc, content);
  return doc.output('blob');
}

/** Connection list on the following page(s): one row per wire. */
function addConnectionPages(doc: jsPDF, content: DiagramContent) {
  const rows = connectionRows(content);
  if (!rows.length) return;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const rowH = 17;
  const cols = [
    { title: '#', x: M, w: 22 },
    { title: 'From', x: M + 22, w: 150 },
    { title: 'Pin', x: M + 172, w: 90 },
    { title: 'Wire', x: M + 262, w: 110 },
    { title: 'To', x: M + 372, w: 150 },
    { title: 'Pin', x: M + 522, w: 90 },
    { title: 'Label', x: M + 612, w: W - 2 * M - 612 },
  ];
  const place = [content.title.room, content.title.prop].filter((v) => v.trim()).join(' / ');
  const fit = (t: string, w: number) => doc.splitTextToSize(pdfText(t), w - 6)[0] ?? '';

  let y = 0;
  const header = (cont: boolean) => {
    doc.addPage('letter', 'landscape');
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(pdfText(`Connections${cont ? ' (continued)' : ''}`), M, M + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (place) doc.text(pdfText(place), W - M, M + 12, { align: 'right' });
    y = M + 34;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    for (const c of cols) doc.text(c.title, c.x + 3, y);
    doc.setDrawColor(40);
    doc.setLineWidth(0.8);
    doc.line(M, y + 5, W - M, y + 5);
    y += 5;
  };

  header(false);
  rows.forEach((r, i) => {
    if (y + rowH > H - M) header(true);
    const base = y + rowH - 5;
    if (i % 2 === 1) {
      doc.setFillColor(245, 247, 250);
      doc.rect(M, y, W - 2 * M, rowH, 'F');
    }
    doc.setTextColor(20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(String(i + 1), cols[0].x + 3, base);
    doc.setFont('helvetica', 'bold');
    doc.text(fit(r.from.part, cols[1].w), cols[1].x + 3, base);
    doc.text(fit(r.to.part, cols[4].w), cols[4].x + 3, base);
    doc.setFont('courier', 'normal');
    doc.text(fit(r.from.pin, cols[2].w), cols[2].x + 3, base);
    doc.text(fit(r.to.pin, cols[5].w), cols[5].x + 3, base);
    doc.setFont('helvetica', 'normal');
    // Wire swatch (striped cable drawn as two halves) + name.
    const sx = cols[3].x + 3;
    const sy = y + 5;
    doc.setDrawColor(60);
    doc.setLineWidth(0.5);
    doc.setFillColor(WIRE_COLORS[r.color].hex);
    doc.rect(sx, sy, 18, 7, 'F');
    if (r.stripe) {
      doc.setFillColor(WIRE_COLORS[r.stripe].hex);
      doc.rect(sx + 9, sy, 9, 7, 'F');
    }
    doc.rect(sx, sy, 18, 7, 'S');
    doc.text(fit(r.colorName, cols[3].w - 24), sx + 23, base);
    doc.text(fit(r.label, cols[6].w), cols[6].x + 3, base);
    doc.setDrawColor(225);
    doc.line(M, y + rowH, W - M, y + rowH);
    y += rowH;
  });
}
