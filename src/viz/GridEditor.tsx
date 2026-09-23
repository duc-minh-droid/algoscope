import { useRef, useState } from 'react';
import type { Cell } from './GridView';

export interface PaletteEntry {
  value: number;
  label: string;
  color: string;
}

export interface MarkerSpec {
  key: string;
  label: string; // short label drawn on the cell, e.g. "S"
  name: string; // button text, e.g. "Start"
  color: string;
  cell: Cell;
}

export interface GridEditorProps {
  grid: number[][];
  onGrid: (g: number[][]) => void;
  palette: PaletteEntry[];
  markers?: MarkerSpec[];
  onMarker?: (key: string, cell: Cell) => void;
  minSize?: number;
  maxSize?: number;
  /** Extra buttons (e.g. "Random maze"). */
  actions?: { label: string; run: () => void }[];
}

/** Paint-by-drag grid editor. Pick a colour (or marker) from the palette and drag across cells. */
export function GridEditor({ grid, onGrid, palette, markers = [], onMarker, minSize = 3, maxSize = 16, actions = [] }: GridEditorProps) {
  const [brush, setBrush] = useState<string>(`v${palette[palette.length > 1 ? 1 : 0].value}`);
  const painting = useRef(false);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const paint = (r: number, c: number) => {
    if (brush.startsWith('m:')) {
      onMarker?.(brush.slice(2), [r, c]);
      return;
    }
    const v = Number(brush.slice(1));
    if (grid[r][c] === v) return;
    onGrid(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  };

  const resize = (nr: number, nc: number) => {
    nr = Math.max(minSize, Math.min(maxSize, nr));
    nc = Math.max(minSize, Math.min(maxSize, nc));
    onGrid(Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) => grid[r]?.[c] ?? palette[0].value)));
    markers.forEach((m) => {
      if (m.cell[0] >= nr || m.cell[1] >= nc) onMarker?.(m.key, [Math.min(m.cell[0], nr - 1), Math.min(m.cell[1], nc - 1)]);
    });
  };

  const colorOf = (v: number) => palette.find((p) => p.value === v)?.color ?? 'var(--ink-3)';

  return (
    <div className="gde">
      <div className="gde-toolbar">
        <div className="gde-palette">
          {palette.map((p) => (
            <button key={p.value} className={`swatch ${brush === `v${p.value}` ? 'on' : ''}`} onClick={() => setBrush(`v${p.value}`)} title={p.label}>
              <i style={{ background: p.color }} />
              {p.label}
            </button>
          ))}
          {markers.map((m) => (
            <button key={m.key} className={`swatch ${brush === `m:${m.key}` ? 'on' : ''}`} onClick={() => setBrush(`m:${m.key}`)}>
              <i className="round" style={{ background: m.color }}>
                {m.label}
              </i>
              {m.name}
            </button>
          ))}
        </div>
        <div className="gde-size">
          <Stepper label="rows" value={rows} onChange={(v) => resize(v, cols)} />
          <Stepper label="cols" value={cols} onChange={(v) => resize(rows, v)} />
          {actions.map((a) => (
            <button key={a.label} className="btn ghost sm" onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="gde-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, maxWidth: cols * 38 }}
        onPointerLeave={() => (painting.current = false)}
        onPointerUp={() => (painting.current = false)}
      >
        {grid.map((row, r) =>
          row.map((v, c) => {
            const m = markers.find((mk) => mk.cell[0] === r && mk.cell[1] === c);
            return (
              <div
                key={`${r}-${c}`}
                className="gde-cell"
                style={{ background: colorOf(v) }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  painting.current = !brush.startsWith('m:');
                  paint(r, c);
                }}
                onPointerEnter={() => painting.current && paint(r, c)}
              >
                {m && (
                  <span className="gde-marker" style={{ background: m.color }}>
                    {m.label}
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>
      <p className="field-hint">Pick a brush, then click or drag across cells.</p>
    </div>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <button onClick={() => onChange(value - 1)} aria-label={`fewer ${label}`}>
        −
      </button>
      <b>{value}</b> {label}
      <button onClick={() => onChange(value + 1)} aria-label={`more ${label}`}>
        +
      </button>
    </span>
  );
}
