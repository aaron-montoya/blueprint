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

export const APP_HEADER = 'ESCAPES IN TIME — WIRING';

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

/** PNG export: the diagram with the title block and pin-color legend underneath. */
export async function renderPng(content: DiagramContent): Promise<Blob> {
  const d = await renderDiagram(content, 3000);
  const img = await loadImage(d.dataUrl);
  const s = d.ratio;
  const footerH = 190 * s;
  const minW = 640 * s;
  const W = Math.max(img.width, minW);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W);
  canvas.height = Math.round(img.height + footerH);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const y0 = img.height + 10 * s;
  const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px * s}px system-ui, Segoe UI, Arial, sans-serif`;
  // Title block
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2 * s;
  ctx.strokeRect(20 * s, y0, 330 * s, 165 * s);
  ctx.fillStyle = '#111';
  ctx.font = font(14, true);
  ctx.fillText(APP_HEADER, 32 * s, y0 + 24 * s);
  titleRows(content.title).forEach((r, i) => {
    const y = y0 + (50 + i * 25) * s;
    ctx.font = font(12, true);
    ctx.fillText(r.label, 32 * s, y);
    ctx.font = font(12);
    ctx.fillText(r.value || '—', 120 * s, y);
  });
  // Legend
  const lx = 370 * s;
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(lx, y0, 250 * s, 165 * s);
  ctx.font = font(12, true);
  ctx.fillText('Pin colors', lx + 12 * s, y0 + 22 * s);
  legendEntries().forEach((e, i) => {
    const y = y0 + (38 + i * 21) * s;
    ctx.fillStyle = e.color;
    ctx.fillRect(lx + 12 * s, y, 12 * s, 12 * s);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(lx + 12 * s, y, 12 * s, 12 * s);
    ctx.fillStyle = '#111';
    ctx.font = font(12);
    ctx.fillText(e.label, lx + 32 * s, y + 11 * s);
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}
