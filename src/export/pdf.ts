import { jsPDF } from 'jspdf';
import type { DiagramContent } from '../store/convert';
import { APP_HEADER, diagramBounds, legendEntries, renderDiagram, titleRows } from './render';

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
  doc.text(APP_HEADER, M + 10, fy + 18);
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
    doc.text(doc.splitTextToSize(r.value || '—', 120)[0] ?? '', x + 58, y);
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
  return doc.output('blob');
}
