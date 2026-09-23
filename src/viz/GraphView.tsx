import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Tone } from '@/core/types';
import { ek, GRAPH_H, GRAPH_W, type GEdge, type GNode } from './graph';
import { toneFill, toneInk } from './tones';

export interface Traveler {
  from: string;
  to: string;
  tone?: Tone;
  /** Change this (e.g. to the frame index) to replay the dot on the same edge. */
  replay?: string | number;
}

export interface GraphViewProps {
  nodes: GNode[];
  edges: GEdge[];
  directed?: boolean;
  weighted?: boolean;
  nodeTones?: Record<string, Tone | undefined>;
  /** Keyed by ek(from, to). For undirected graphs either order works. */
  edgeTones?: Record<string, Tone | undefined>;
  /** Override the weight label of an edge (keyed by ek). */
  edgeLabels?: Record<string, string | undefined>;
  /** Small pill attached to a node (e.g. tentative distance). */
  nodeBadges?: Record<string, string | number | undefined>;
  badgeTones?: Record<string, Tone | undefined>;
  /** Text drawn under a node. */
  nodeSubs?: Record<string, string | undefined>;
  /** Pulsing ring around nodes (e.g. current node). */
  rings?: Record<string, Tone | undefined>;
  /** A dot that glides along an edge each time this list changes — use for "exploring edge". */
  travelers?: Traveler[];
  /** Fade edges/nodes that have no tone (focus mode). */
  dimIdle?: boolean;
  /** Extra SVG drawn on top, in graph coordinates. */
  overlay?: ReactNode;
  /** Extra SVG drawn beneath edges and nodes (halos, waves, regions). */
  underlay?: ReactNode;
  className?: string;
}

const R = 22;

function lookup<T>(map: Record<string, T | undefined> | undefined, a: string, b: string, directed?: boolean) {
  if (!map) return undefined;
  return map[ek(a, b)] ?? (directed ? undefined : map[ek(b, a)]);
}
const getTone = lookup<Tone>;

export function edgeGeometry(a: GNode, b: GNode, curved: boolean) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bend = curved ? 34 : 0;
  const mx = (a.x + b.x) / 2 - uy * bend;
  const my = (a.y + b.y) / 2 + ux * bend;
  // start/end points pushed to the circle border (towards control point for curves)
  const sdx = mx - a.x, sdy = my - a.y, sl = Math.hypot(sdx, sdy) || 1;
  const edx = b.x - mx, edy = b.y - my, el = Math.hypot(edx, edy) || 1;
  const sx = a.x + (sdx / sl) * R, sy = a.y + (sdy / sl) * R;
  const ex = b.x - (edx / el) * (R + 3), ey = b.y - (edy / el) * (R + 3);
  const d = curved ? `M${sx} ${sy} Q${mx} ${my} ${ex} ${ey}` : `M${sx} ${sy} L${ex} ${ey}`;
  // label point: on the curve midpoint
  const lx = curved ? 0.25 * sx + 0.5 * mx + 0.25 * ex : (sx + ex) / 2;
  const ly = curved ? 0.25 * sy + 0.5 * my + 0.25 * ey : (sy + ey) / 2;
  const ang = Math.atan2(ey - (curved ? my : sy), ex - (curved ? mx : sx));
  return { d, sx, sy, ex, ey, lx, ly, ang, mx, my };
}

export function GraphView({
  nodes,
  edges,
  directed,
  weighted,
  nodeTones = {},
  edgeTones,
  edgeLabels,
  nodeBadges = {},
  badgeTones = {},
  nodeSubs = {},
  rings = {},
  travelers = [],
  dimIdle,
  overlay,
  underlay,
  className,
}: GraphViewProps) {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const pair = new Set(edges.map((e) => ek(e.from, e.to)));

  return (
    <svg className={`gv ${className ?? ''}`} viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} role="img" aria-label="graph">
      {underlay}
      <g>
        {edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const curved = !!directed && pair.has(ek(e.to, e.from));
          const g = edgeGeometry(a, b, curved);
          const tone = getTone(edgeTones, e.from, e.to, directed);
          const label = lookup(edgeLabels, e.from, e.to, directed) ?? (weighted ? String(e.w) : undefined);
          const stroke = tone ? toneFill(tone) : 'var(--gv-edge)';
          return (
            <g key={ek(e.from, e.to)} className="gv-edge" data-tone={tone ?? 'idle'} data-dim={dimIdle && !tone ? '' : undefined}>
              <path d={g.d} className="gv-edge-line" style={{ stroke, d: `path('${g.d}')` } as CSSProperties} />
              {directed && (
                <path
                  className="gv-arrow"
                  d="M0 0 L-11 -5.5 L-11 5.5 Z"
                  style={{ fill: stroke, transform: `translate(${g.ex}px, ${g.ey}px) rotate(${(g.ang * 180) / Math.PI}deg)` }}
                />
              )}
              {label !== undefined && (
                <g style={{ transform: `translate(${g.lx}px, ${g.ly}px)` }} className="gv-w">
                  <rect x={-13 - (label.length - 1) * 3.5} y={-10} width={26 + (label.length - 1) * 7} height={20} rx={10} style={{ stroke }} />
                  <text y={4.5}>{label}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      {travelers.map((t, i) => {
        const a = pos.get(t.from);
        const b = pos.get(t.to);
        if (!a || !b) return null;
        const curved = !!directed && pair.has(ek(t.to, t.from));
        return <TravelerDot key={`${t.from}-${t.to}-${i}-${t.replay ?? ''}`} geo={edgeGeometry(a, b, curved)} tone={t.tone ?? 'active'} curved={curved} />;
      })}

      {nodes.map((n) => {
        const tone = nodeTones[n.id];
        const ring = rings[n.id];
        const badge = nodeBadges[n.id];
        const sub = nodeSubs[n.id];
        return (
          <g
            key={n.id}
            className="gv-node"
            style={{ transform: `translate(${n.x}px, ${n.y}px)` }}
            data-tone={tone ?? 'idle'}
            data-dim={dimIdle && !tone ? '' : undefined}
          >
            {ring && <circle className="gv-ring" r={R + 7} style={{ stroke: toneFill(ring) }} />}
            <circle className="gv-disc" r={R} style={{ fill: tone ? toneFill(tone) : 'var(--ink-3)' }} />
            <text className="gv-label" y={6} style={{ fill: tone ? toneInk(tone) : 'var(--paper)' }}>
              {n.id}
            </text>
            {badge !== undefined && badge !== '' && (
              <g className="gv-badge" transform={`translate(${R - 2} ${-R + 2})`}>
                <rect
                  x={0}
                  y={-11}
                  width={Math.max(22, String(badge).length * 8 + 12)}
                  height={20}
                  rx={10}
                  style={{ fill: toneFill(badgeTones[n.id] ?? 'path') }}
                />
                <text x={Math.max(22, String(badge).length * 8 + 12) / 2} y={3.5} style={{ fill: toneInk(badgeTones[n.id] ?? 'path') }}>
                  {badge}
                </text>
              </g>
            )}
            {sub && (
              <text className="gv-sub" y={R + 18}>
                {sub}
              </text>
            )}
          </g>
        );
      })}
      {overlay}
    </svg>
  );
}

function TravelerDot({ geo, tone, curved }: { geo: ReturnType<typeof edgeGeometry>; tone: Tone; curved: boolean }) {
  const ref = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ms = parseFloat(getComputedStyle(el).getPropertyValue('--step-ms')) || 450;
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      if (!curved) return [geo.sx + (geo.ex - geo.sx) * t, geo.sy + (geo.ey - geo.sy) * t];
      const u = 1 - t;
      return [u * u * geo.sx + 2 * u * t * geo.mx + t * t * geo.ex, u * u * geo.sy + 2 * u * t * geo.my + t * t * geo.ey];
    });
    const anim = el.animate(
      pts.map(([x, y], i) => ({ transform: `translate(${x}px, ${y}px)`, opacity: i === 0 ? 0 : i === 4 ? 0.2 : 1 })),
      { duration: Math.max(200, ms * 1.1), easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'forwards' },
    );
    return () => anim.cancel();
  }, [geo.d]);
  return <circle ref={ref} r={7} className="gv-traveler" style={{ fill: toneFill(tone), transform: `translate(${geo.ex}px, ${geo.ey}px)` }} />;
}
