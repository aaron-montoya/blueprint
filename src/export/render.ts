import { toPng } from 'html-to-image';
import { PIN_TYPE_INFO, PIN_TYPES, TITLE_FIELDS, type TitleBlock } from '../model/format';
import { computeWireGeometry } from '../geometry/wireGeometry';
import { nodeRect } from '../store/diagramStore';
import type { DiagramContent } from '../store/convert';

const PAD = 40;

/** Everything drawn on the canvas: nodes plus every wire bend. */
export function diagramBounds({ nodes, edges }: DiagramContent) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const n of nodes) {
    const r = nodeRect(n);
    add(r.x, r.y);
    add(r.x + r.width, r.y + r.height);
  }
  for (const g of computeWireGeometry(nodes, edges).values()) for (const p of g.points) add(p.x, p.y);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 400, height: 300 };
  return { x: x0 - PAD, y: y0 - PAD, width: x1 - x0 + 2 * PAD, height: y1 - y0 + 2 * PAD };
}

const HIDE_IN_EXPORT = ['react-flow__resize-control', 'wire-handle', 'react-flow__nodesselection', 'react-flow__selection'];

/**
 * Render the whole diagram (not just what's on screen) to a PNG data URL.
 * `targetPx` is the desired width of the long side, in pixels.
 */
export async function renderDiagram(content: DiagramContent, targetPx: number) {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  const wrapper = document.querySelector<HTMLElement>('.react-flow');
  if (!viewport || !wrapper) throw new Error('Canvas not ready');
  const b = diagramBounds(content);
  const long = Math.max(b.width, b.height);
  const maxArea = 40e6;
  let ratio = Math.min(4, Math.max(1, targetPx / long));
  ratio = Math.min(ratio, Math.sqrt(maxArea / (b.width * b.height)));
  wrapper.classList.add('exporting');
  try {
    const dataUrl = await toPng(viewport, {
      backgroundColor: '#ffffff',
      width: b.width,
      height: b.height,
      pixelRatio: ratio,
      style: {
        width: `${b.width}px`,
        height: `${b.height}px`,
        transform: `translate(${-b.x}px, ${-b.y}px) scale(1)`,
      },
      filter: (el) => !(el instanceof Element && HIDE_IN_EXPORT.some((c) => el.classList.contains(c))),
    });
    return { dataUrl, width: b.width, height: b.height, ratio };
  } finally {
    wrapper.classList.remove('exporting');
  }
}


export const legendEntries = () => PIN_TYPES.map((t) => ({ label: PIN_TYPE_INFO[t].label, color: PIN_TYPE_INFO[t].color }));

export const titleRows = (title: TitleBlock) => TITLE_FIELDS.map((f) => ({ label: f.label, value: title[f.key] }));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the diagram image'));
    img.src = src;
  });
}

/** PNG export: the diagram with a slim title block and pin-color strip underneath. */
export async function renderPng(content: DiagramContent): Promise<Blob> {
  const d = await renderDiagram(content, 3000);
  const img = await loadImage(d.dataUrl);
  const s = d.ratio;
  const rows = titleRows(content.title);
  const colW = 150;
  const legendW = 3 * 118 + 24;
  const titleW = 24 + rows.length * colW;
  const stripW = titleW + legendW;
  const stripH = 62;
  const W = Math.max(img.width, (stripW + 40) * s);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W);
  canvas.height = Math.round(img.height + (stripH + 30) * s);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const x0 = 20 * s;
  const y0 = img.height + 10 * s;
  const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px * s}px system-ui, Segoe UI, Arial, sans-serif`;
  /** Cut `text` to fit `maxW` (in unscaled px), adding an ellipsis. */
  const fit = (text: string, maxW: number) => {
    if (ctx.measureText(text).width <= maxW * s) return text;
    let t = text;
    while (t && ctx.measureText(`${t}…`).width > maxW * s) t = t.slice(0, -1);
    return `${t}…`;
  };
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5 * s;
  ctx.strokeRect(x0, y0, stripW * s, stripH * s);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(x0 + titleW * s, y0);
  ctx.lineTo(x0 + titleW * s, y0 + stripH * s);
  ctx.stroke();

  // Title block: heading, then the fields in one row.
  ctx.fillStyle = '#111';
  ctx.font = font(13, true);
  ctx.fillText(fit(content.title.heading, titleW - 24), x0 + 12 * s, y0 + 19 * s);
  rows.forEach((r, i) => {
    const x = x0 + (12 + i * colW) * s;
    ctx.fillStyle = '#6b7280';
    ctx.font = font(9, true);
    ctx.fillText(r.label.toUpperCase(), x, y0 + 36 * s);
    ctx.fillStyle = '#111';
    ctx.font = font(12);
    ctx.fillText(fit(r.value || '—', colW - 8), x, y0 + 52 * s);
  });

  // Pin colors: two rows of three.
  const lx = x0 + (titleW + 12) * s;
  ctx.fillStyle = '#6b7280';
  ctx.font = font(9, true);
  ctx.fillText('PIN COLORS', lx, y0 + 15 * s);
  ctx.font = font(11);
  ctx.strokeStyle = '#333';
  legendEntries().forEach((e, i) => {
    const x = lx + (i % 3) * 118 * s;
    const y = y0 + (23 + Math.floor(i / 3) * 18) * s;
    ctx.fillStyle = e.color;
    ctx.fillRect(x, y, 10 * s, 10 * s);
    ctx.strokeRect(x, y, 10 * s, 10 * s);
    ctx.fillStyle = '#111';
    ctx.fillText(e.label, x + 15 * s, y + 9 * s);
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}
