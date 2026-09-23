/**
 * Helpers shared by kruskal / dijkstra / bellman-ford / floyd-warshall.
 * (Files starting with `_` are not registered as algorithms.)
 */
import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from '@/core/types';
import { fmtInf } from '@/core/utils';
import { ArrayView, toneFill, toneInk, type Graph, type GNode } from '@/viz';

export const INF = Infinity;
export const f = fmtInf;

/** Friendly validation shared by the graph algorithms. Throws Error with a readable message. */
export function checkGraph(g: Graph, o: { source?: boolean; maxNodes?: number; maxEdges?: number; noNegative?: boolean } = {}) {
  if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) throw new Error('The graph is empty — double-click the canvas to add a few nodes.');
  if (o.maxNodes && g.nodes.length > o.maxNodes) throw new Error(`Keep it to ${o.maxNodes} nodes or fewer so the picture stays readable.`);
  if (o.maxEdges && g.edges.length > o.maxEdges) throw new Error(`Keep it to ${o.maxEdges} edges or fewer so the animation stays watchable.`);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`Edge ${e.from}–${e.to} points at a node that doesn't exist.`);
    if (!Number.isFinite(e.w)) throw new Error(`Edge ${e.from}–${e.to} needs a numeric weight.`);
    if (o.noNegative && e.w < 0) throw new Error(`Edge ${e.from}–${e.to} has a negative weight (${e.w}); this algorithm needs weights ≥ 0.`);
  }
  if (o.source && (!g.source || !ids.has(g.source))) throw new Error('Pick a start node (use the "Start" tool in the editor).');
}

/** Graph on the left, a narrower side panel on the right; wraps on small screens. */
export function Split({ main, side, sideBasis = 190, gap = 18 }: { main: ReactNode; side: ReactNode; sideBasis?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, width: '100%', alignItems: 'flex-start' }}>
      <div style={{ flex: '3 1 420px', minWidth: 0 }}>{main}</div>
      <div style={{ flex: `1 1 ${sideBasis}px`, minWidth: 0 }}>{side}</div>
    </div>
  );
}

/** A hand-drawn "wobble" filter usable from any overlay: filter={`url(#${id})`}. */
export function RoughDefs({ id, scale = 2.6 }: { id: string; scale?: number }) {
  return (
    <defs>
      <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={7} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={scale} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  );
}

export const nodeMap = (g: Graph) => new Map<string, GNode>(g.nodes.map((n) => [n.id, n]));

/** Row of distance cells captioned with node ids. */
export function DistRow({ ids, dist, tones, cell = 44 }: { ids: string[]; dist: Record<string, number>; tones?: (id: string) => Tone | undefined; cell?: number }) {
  return (
    <ArrayView
      items={ids.map((id) => f(dist[id] ?? INF))}
      caption={(i) => ids[i] ?? ''}
      tones={(i) => tones?.(ids[i])}
      cell={cell}
      gap={6}
    />
  );
}

/** Small pill (HTML) coloured by tone. */
export function Chip({ tone = 'idle', children, strike, glow, style }: { tone?: Tone; children: ReactNode; strike?: boolean; glow?: boolean; style?: CSSProperties }) {
  const idle = tone === 'idle';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 12.5,
        fontWeight: 600,
        background: idle ? 'var(--ink-3)' : toneFill(tone),
        color: toneInk(tone),
        border: idle ? '1px solid var(--line-strong)' : '1px solid transparent',
        textDecoration: strike ? 'line-through' : undefined,
        opacity: tone === 'muted' ? 0.6 : 1,
        boxShadow: glow ? `0 0 0 2px var(--ink-0), 0 0 0 4px ${toneFill(tone)}` : undefined,
        transform: glow ? 'translateX(6px)' : undefined,
        transition: 'background-color var(--step-ms) ease, color var(--step-ms) ease, transform var(--step-ms) var(--ease-out), box-shadow var(--step-ms) ease',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Walk parent pointers back from t. Returns [] if t is unreachable or a loop is hit. */
export function pathTo(prev: Record<string, string | null>, s: string, t: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = t;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(cur);
    if (cur === s) return out;
    cur = prev[cur] ?? null;
  }
  return [];
}

export const PALETTE = ['#5fd3a5', '#6cb6ff', '#a98bff', '#ff5fa2', '#f5b544', '#c6f36b', '#ff6b5b', '#ffd166', '#7ee0e0', '#e0a0ff', '#ffa07a', '#9ad0ff', '#d4e157', '#f48fb1'];
