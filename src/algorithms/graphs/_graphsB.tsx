/* Helpers shared by topological-sort, flood-fill and lee-algorithm (graphs, batch B). */
import type { CSSProperties } from 'react';
import type { Tone } from '@/core/types';
import type { Cell } from '@/viz';

export const GRID_GAP = 3; // must match GridView's internal gap

/** Top-left corner of a cell inside a GridView of the given cell size. */
export const cellOrigin = (size: number, [r, c]: Cell) => ({ x: GRID_GAP + c * (size + GRID_GAP), y: GRID_GAP + r * (size + GRID_GAP) });

export const cellKey = ([r, c]: Cell) => `${r},${c}`;

export const DIRS: Cell[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

export const DIR_NAME = ['up', 'right', 'down', 'left'];

/** Linear interpolation between two #rrggbb colours. */
export function lerpHex(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const k = Math.max(0, Math.min(1, t));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

/** Dashed, marching outlines around a set of grid cells (frontier / queued cells). Render inside GridView `overlay`. */
export function CellOutlines({ cells, size, color, prefix, numbered }: { cells: Cell[]; size: number; color: string; prefix: string; numbered?: boolean }) {
  return (
    <g pointerEvents="none">
      <style>{`
        .${prefix}-ol { fill: none; stroke-width: 2.4; stroke-dasharray: 5 4; animation: ${prefix}-march 0.9s linear infinite; transition: opacity var(--step-ms) ease; }
        .${prefix}-oln { font-family: var(--font-mono); font-size: ${Math.max(8, size * 0.22)}px; font-weight: 700; }
        @keyframes ${prefix}-march { to { stroke-dashoffset: -18; } }
        @media (prefers-reduced-motion: reduce) { .${prefix}-ol { animation: none; } }
      `}</style>
      {cells.map((cell, i) => {
        const { x, y } = cellOrigin(size, cell);
        return (
          <g key={cellKey(cell)} transform={`translate(${x} ${y})`}>
            <rect className={`${prefix}-ol`} x={1.5} y={1.5} width={size - 3} height={size - 3} rx={size * 0.16} style={{ stroke: color }} />
            {numbered && i < 99 && (
              <text className={`${prefix}-oln`} x={4} y={size * 0.28} style={{ fill: color }}>
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Wobbly "ink splash" rings that burst from freshly touched cells. `stamp` must change every frame to replay. */
export function Splashes({ cells, size, color, prefix, stamp }: { cells: Cell[]; size: number; color: string; prefix: string; stamp: number }) {
  return (
    <g pointerEvents="none">
      <style>{`
        .${prefix}-sp { fill: none; stroke-width: 2.2; opacity: 0; transform-box: fill-box; transform-origin: center;
          animation: ${prefix}-burst calc(var(--step-ms) * 1.4) var(--ease-out); }
        @keyframes ${prefix}-burst { 0% { opacity: 0.95; transform: scale(0.55) rotate(0deg); } 100% { opacity: 0; transform: scale(1.5) rotate(25deg); } }
        @media (prefers-reduced-motion: reduce) { .${prefix}-sp { animation: none; } }
      `}</style>
      {cells.map((cell) => {
        const { x, y } = cellOrigin(size, cell);
        const cx = x + size / 2;
        const cy = y + size / 2;
        const rr = size * 0.55;
        // hand-drawn blob: 8 jittered points around the centre, deterministic per cell
        const pts = Array.from({ length: 8 }, (_, k) => {
          const a = (k / 8) * Math.PI * 2;
          const j = 0.82 + (((cell[0] * 7 + cell[1] * 13 + k * 5) % 7) / 7) * 0.36;
          return [cx + Math.cos(a) * rr * j, cy + Math.sin(a) * rr * j];
        });
        const d = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ') + 'Z';
        return <path key={`${stamp}-${cellKey(cell)}`} className={`${prefix}-sp`} d={d} style={{ stroke: color }} strokeLinejoin="round" />;
      })}
    </g>
  );
}

/** Compact queue/stack rendering: first `max` items then "+N". */
export function cellTokens(cells: Cell[], tone: Tone, max = 14, headTone: Tone = 'active') {
  const items = cells.slice(0, max).map((c, i) => ({ id: cellKey(c), text: `${c[0]},${c[1]}`, tone: i === 0 ? headTone : tone }));
  if (cells.length > max) items.push({ id: 'more', text: `+${cells.length - max}`, tone: 'frontier' as Tone });
  return items;
}

/** Shared tiny form styles for custom Editors (inline so no CSS import is needed). */
export const editorRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 12 };
