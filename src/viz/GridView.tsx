import type { ReactNode } from 'react';
import type { Tone } from '@/core/types';
import { toneFill, toneInk } from './tones';

export type Cell = [number, number]; // [row, col]

export interface CellLook {
  tone?: Tone;
  /** Raw CSS colour; overrides tone (e.g. flood-fill paint colours). */
  fill?: string;
  label?: string | number;
  /** Label colour override (defaults to readable ink for tones, cream otherwise). */
  labelColor?: string;
  wall?: boolean;
  /** Pop-in animation key: change it to replay the "splash" when the cell gets painted/visited. */
  pulse?: boolean;
}

export interface GridMarker {
  cell: Cell;
  label: string;
  color: string;
}

export interface GridViewProps {
  rows: number;
  cols: number;
  cell: (r: number, c: number) => CellLook;
  /** Polyline through cell centres (e.g. shortest path). Draws itself in. */
  path?: Cell[];
  pathTone?: Tone;
  /** Ringed cursor at the cell being processed. */
  cursor?: Cell | null;
  cursorTone?: Tone;
  markers?: GridMarker[];
  size?: number;
  overlay?: ReactNode;
}

export function GridView({ rows, cols, cell, path, pathTone = 'path', cursor, cursorTone = 'active', markers = [], size = 40, overlay }: GridViewProps) {
  const gap = 3;
  const s = size;
  const W = cols * (s + gap) + gap;
  const H = rows * (s + gap) + gap;
  const cx = (c: number) => gap + c * (s + gap) + s / 2;
  const cy = (r: number) => gap + r * (s + gap) + s / 2;

  const cells: ReactNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const look = cell(r, c);
      const fill = look.wall ? 'var(--grid-wall)' : look.fill ?? (look.tone ? toneFill(look.tone) : 'var(--grid-empty)');
      cells.push(
        <g key={`${r}-${c}`} transform={`translate(${gap + c * (s + gap)} ${gap + r * (s + gap)})`}>
          <rect className={`gd-cell ${look.pulse ? 'gd-pulse' : ''}`} width={s} height={s} rx={s * 0.18} style={{ fill }} data-wall={look.wall ? '' : undefined} />
          {look.label !== undefined && look.label !== '' && (
            <text className="gd-label" x={s / 2} y={s / 2 + s * 0.13} fontSize={s * 0.36} style={{ fill: look.labelColor ?? (look.tone && !look.fill ? toneInk(look.tone) : 'var(--paper)') }}>
              {look.label}
            </text>
          )}
        </g>,
      );
    }

  const pathD = path && path.length > 1 ? path.map(([r, c], i) => `${i ? 'L' : 'M'}${cx(c)} ${cy(r)}`).join(' ') : null;

  return (
    <svg className="gd" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W * 1.4 }} role="img" aria-label="grid">
      {cells}
      {pathD && <path key={pathD} className="gd-path" d={pathD} pathLength={1} style={{ stroke: toneFill(pathTone) }} />}
      {markers.map((m) => (
        <g key={m.label} transform={`translate(${cx(m.cell[1])} ${cy(m.cell[0])})`} className="gd-marker">
          <circle r={s * 0.3} style={{ fill: m.color }} />
          <text y={s * 0.11} fontSize={s * 0.3}>
            {m.label}
          </text>
        </g>
      ))}
      {cursor && (
        <rect
          className="gd-cursor"
          width={s + 6}
          height={s + 6}
          rx={s * 0.22}
          style={{ stroke: toneFill(cursorTone), transform: `translate(${cx(cursor[1]) - s / 2 - 3}px, ${cy(cursor[0]) - s / 2 - 3}px)` }}
        />
      )}
      {overlay}
    </svg>
  );
}
