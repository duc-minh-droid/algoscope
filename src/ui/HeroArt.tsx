import { useEffect, useMemo, useState } from 'react';

/** Bubble-sort trace of a fixed array: list of [array, i, j, swapped] snapshots. */
function bubbleTrace(start: number[]) {
  const a = start.map((v, id) => ({ v, id }));
  const out: { arr: { v: number; id: number }[]; i: number; swap: boolean; sorted: number }[] = [];
  for (let end = a.length - 1; end > 0; end--) {
    for (let i = 0; i < end; i++) {
      const swap = a[i].v > a[i + 1].v;
      out.push({ arr: [...a], i, swap, sorted: a.length - 1 - end });
      if (swap) {
        [a[i], a[i + 1]] = [a[i + 1], a[i]];
        out.push({ arr: [...a], i, swap: true, sorted: a.length - 1 - end });
      }
    }
  }
  out.push({ arr: [...a], i: -1, swap: false, sorted: a.length });
  return out;
}

const START = [5, 2, 7, 3, 6, 1, 4];

const NODES = [
  { id: 'A', x: 70, y: 70 },
  { id: 'B', x: 180, y: 40 },
  { id: 'C', x: 150, y: 150 },
  { id: 'D', x: 280, y: 110 },
  { id: 'E', x: 260, y: 215 },
  { id: 'F', x: 370, y: 175 },
];
const EDGES: [string, string][] = [
  ['A', 'B'],
  ['A', 'C'],
  ['B', 'D'],
  ['C', 'D'],
  ['C', 'E'],
  ['D', 'F'],
  ['E', 'F'],
];
const BFS_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];

export function HeroArt() {
  const trace = useMemo(() => bubbleTrace(START), []);
  const [t, setT] = useState(0);
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setT((x) => (x + 1) % (trace.length + 6)), 520);
    return () => clearInterval(id);
  }, [trace.length, reduce]);

  const step = trace[Math.min(t, trace.length - 1)];
  const lit = Math.min(BFS_ORDER.length, Math.floor(t / 4));
  const pos = new Map(NODES.map((n) => [n.id, n]));

  return (
    <svg className="hero-art" viewBox="0 0 520 420" aria-hidden>
      <defs>
        <filter id="sketch">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
        <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="rgba(236,230,214,0.06)" />
        </pattern>
      </defs>

      <rect x="6" y="6" width="508" height="408" rx="18" fill="url(#hero-grid)" stroke="var(--line-strong)" strokeDasharray="3 6" />

      {/* graph: BFS lights up in waves */}
      <g transform="translate(40 20)">
        {EDGES.map(([a, b], k) => {
          const p = pos.get(a)!;
          const q = pos.get(b)!;
          const on = BFS_ORDER.indexOf(b) < lit && BFS_ORDER.indexOf(a) < lit;
          return (
            <line
              key={k}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              className="hero-edge"
              pathLength={1}
              style={{ animationDelay: `${k * 90}ms`, stroke: on ? 'var(--sky)' : undefined }}
            />
          );
        })}
        {NODES.map((n, k) => {
          const i = BFS_ORDER.indexOf(n.id);
          const state = i < lit - 1 ? 'visited' : i === lit - 1 ? 'active' : i === lit ? 'frontier' : 'idle';
          return (
            <g key={n.id} className="hero-node" data-state={state} transform={`translate(${n.x} ${n.y})`} style={{ animationDelay: `${300 + k * 70}ms` }}>
              <circle r="17" />
              <text y="5">{n.id}</text>
            </g>
          );
        })}
        <text className="hero-note" x="300" y="40" filter="url(#sketch)">
          breadth first!
        </text>
        <path className="hero-scribble" d="M298 46 C 270 60, 250 70, 232 96" pathLength={1} filter="url(#sketch)" />
      </g>

      {/* bars: bubble sort on loop */}
      <g transform="translate(92 290)">
        <line x1="-20" x2="356" y1="100" y2="100" stroke="var(--line-strong)" />
        {step.arr.map((it, k) => {
          const cmp = k === step.i || k === step.i + 1;
          const done = k >= step.arr.length - step.sorted;
          const fill = done ? 'var(--mint)' : cmp ? (step.swap ? 'var(--magenta)' : 'var(--coral)') : 'var(--t-idle)';
          return (
            <g key={it.id} className="hero-bar" style={{ transform: `translate(${k * 48}px, 0px)` }}>
              <rect x="0" y={100 - it.v * 13} width="36" height={it.v * 13} rx="6" style={{ fill }} />
              <text x="18" y={92 - it.v * 13}>
                {it.v}
              </text>
            </g>
          );
        })}
        {step.i >= 0 && (
          <g className="hero-bar" style={{ transform: `translate(${step.i * 48 + 42}px, 118px)` }}>
            <text className="hero-note small" x="0" y="0" filter="url(#sketch)">
              {step.swap ? 'swap!' : 'compare'}
            </text>
          </g>
        )}
      </g>

      {/* margin doodles */}
      <g className="hero-doodle" filter="url(#sketch)">
        <path d="M482 300 q 14 -30 -6 -52" pathLength={1} />
        <path d="M470 253 l 6 -6 l 3 8" />
      </g>
      <text className="hero-note small" x="470" y="322" filter="url(#sketch)">
        O(n²)
      </text>
    </svg>
  );
}
