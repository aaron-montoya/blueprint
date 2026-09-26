/** Runs "Optimize wires" off the main thread so the page stays responsive. */
import type { DiagramNode, WireEdge } from '../store/types';
import { optimizeWires } from './optimize';

export interface OptimizeRequest {
  nodes: DiagramNode[];
  edges: WireEdge[];
  ids?: string[];
}

const ctx = self as unknown as { onmessage: (e: MessageEvent<OptimizeRequest>) => void; postMessage(m: unknown): void };
ctx.onmessage = (e) => {
  const { nodes, edges, ids } = e.data;
  const r = optimizeWires(nodes, edges, ids && new Set(ids));
  ctx.postMessage({ ...r, points: [...r.points] });
};
