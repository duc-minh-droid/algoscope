import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from '@/core/types';
import { toneFill, toneInk } from './tones';

export interface TreeNode {
  id: string | number;
  label: string | number;
  /** Small text under the node (e.g. frequency, index). */
  sub?: string;
  tone?: Tone;
  children?: (string | number)[];
  shape?: 'circle' | 'pill';
}

export interface TreeViewProps {
  nodes: TreeNode[];
  /** Roots of the forest, left to right. */
  roots: (string | number)[];
  /** Keyed `${parentId}-${childId}`. */
  edgeLabels?: Record<string, string>;
  edgeTones?: Record<string, Tone | undefined>;
  nodeSize?: number;
  levelGap?: number;
  siblingGap?: number;
  /** Minimum viewBox width so small trees don't blow up. */
  minWidth?: number;
  minHeight?: number;
  overlay?: (pos: Map<string | number, { x: number; y: number }>) => ReactNode;
}

/** Tidy-ish layered layout: leaves get consecutive slots, parents centre over children. */
export function layoutForest(nodes: TreeNode[], roots: (string | number)[], slot: number, level: number) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string | number, { x: number; y: number }>();
  let next = 0;
  let depth = 0;
  const place = (id: string | number, d: number, seen: Set<string | number>): number => {
    const n = byId.get(id);
    if (!n || seen.has(id)) return next * slot;
    seen.add(id);
    depth = Math.max(depth, d);
    const kids = (n.children ?? []).filter((k) => byId.has(k));
    let x: number;
    if (!kids.length) x = next++ * slot;
    else {
      const xs = kids.map((k) => place(k, d + 1, seen));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(id, { x, y: d * level });
    return x;
  };
  const seen = new Set<string | number>();
  roots.forEach((r, i) => {
    if (i > 0) next += 0.5;
    place(r, 0, seen);
  });
  return { pos, width: Math.max(0, next - 1) * slot, height: depth * level };
}

export function TreeView({
  nodes,
  roots,
  edgeLabels = {},
  edgeTones = {},
  nodeSize = 40,
  levelGap = 78,
  siblingGap = 14,
  minWidth = 360,
  minHeight = 160,
  overlay,
}: TreeViewProps) {
  const r = nodeSize / 2;
  const { pos, width, height } = layoutForest(nodes, roots, nodeSize + siblingGap, levelGap);
  const pad = r + 26;
  const W = Math.max(minWidth, width + pad * 2);
  const H = Math.max(minHeight, height + pad * 2 + 14);
  const ox = (W - width) / 2;
  const oy = pad;
  const P = (id: string | number) => {
    const p = pos.get(id)!;
    return { x: p.x + ox, y: p.y + oy };
  };
  const shifted = new Map([...pos.keys()].map((k) => [k, P(k)]));

  return (
    <svg className="tv" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W * 1.3 }} role="img" aria-label="tree">
      {nodes.flatMap((n) =>
        pos.has(n.id)
          ? (n.children ?? [])
              .filter((k) => pos.has(k))
              .map((k) => {
                const a = P(n.id);
                const b = P(k);
                const key = `${n.id}-${k}`;
                const tone = edgeTones[key];
                const lbl = edgeLabels[key];
                return (
                  <g key={`e${key}`} className="tv-edge">
                    <path
                      d={`M${a.x} ${a.y} L${b.x} ${b.y}`}
                      style={{ d: `path('M${a.x} ${a.y} L${b.x} ${b.y}')`, stroke: tone ? toneFill(tone) : undefined } as CSSProperties}
                      data-tone={tone}
                    />
                    {lbl && (
                      <text className="tv-elabel" x={(a.x + b.x) / 2 + (b.x < a.x ? -9 : 9)} y={(a.y + b.y) / 2 - 2} style={{ fill: tone ? toneFill(tone) : undefined }}>
                        {lbl}
                      </text>
                    )}
                  </g>
                );
              })
          : [],
      )}
      {nodes.map((n) => {
        if (!pos.has(n.id)) return null;
        const p = P(n.id);
        const tone = n.tone;
        const lbl = String(n.label);
        const w = n.shape === 'pill' ? Math.max(nodeSize, lbl.length * 9 + 20) : nodeSize;
        return (
          <g key={`n${n.id}`} className="tv-node" style={{ transform: `translate(${p.x}px, ${p.y}px)` }} data-tone={tone ?? 'idle'}>
            {n.shape === 'pill' ? (
              <rect x={-w / 2} y={-r} width={w} height={nodeSize} rx={r * 0.6} style={{ fill: tone ? toneFill(tone) : 'var(--ink-3)' }} />
            ) : (
              <circle r={r} style={{ fill: tone ? toneFill(tone) : 'var(--ink-3)' }} />
            )}
            <text className="tv-label" y={nodeSize * 0.13} fontSize={Math.min(nodeSize * 0.4, lbl.length > 3 ? nodeSize * 0.3 : 99)} style={{ fill: tone ? toneInk(tone) : 'var(--paper)' }}>
              {lbl}
            </text>
            {n.sub && (
              <text className="tv-sub" y={r + 15}>
                {n.sub}
              </text>
            )}
          </g>
        );
      })}
      {overlay?.(shifted)}
    </svg>
  );
}
