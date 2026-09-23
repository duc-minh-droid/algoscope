/**
 * Helpers shared by merge-sort, quick-sort and radix-sort (custom SVG stages).
 * Class names are prefixed `sortb-`; styles are injected with <SortBStyle/> inside each SVG.
 */
import type { ReactNode } from 'react';
import type { Tone } from '@/core/types';
import { parseNumberList } from '@/core/utils';
import { toneFill, toneInk } from '@/viz';

const CSS = `
.sortb-x{transition:transform var(--step-ms) var(--ease-out),opacity var(--step-ms) ease}
.sortb-y{transition:transform var(--step-ms) var(--ease-in-out)}
.sortb-move{transition:transform var(--step-ms) var(--ease-in-out),opacity var(--step-ms) ease}
.sortb-fade{transition:opacity var(--step-ms) ease}
.sortb-paint{transition:fill var(--step-ms) ease,stroke var(--step-ms) ease,fill-opacity var(--step-ms) ease,stroke-opacity var(--step-ms) ease,opacity var(--step-ms) ease}
.sortb-geo{transition:x var(--step-ms) var(--ease-in-out),width var(--step-ms) var(--ease-in-out),opacity var(--step-ms) ease,fill var(--step-ms) ease}
.sortb-val{font-family:var(--font-mono);font-weight:600;text-anchor:middle;pointer-events:none}
.sortb-small{font-family:var(--font-mono);font-size:11px;fill:var(--paper-faint);text-anchor:middle}
.sortb-hand{font-family:var(--font-display);font-style:italic;text-anchor:middle}
.sortb-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:sortb-draw calc(var(--step-ms) * 1.6) var(--ease-out) forwards}
.sortb-pop{animation:sortb-pop calc(var(--step-ms) * 1.2) var(--ease-out)}
@keyframes sortb-draw{to{stroke-dashoffset:0}}
@keyframes sortb-pop{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion: reduce){
  .sortb-x,.sortb-y,.sortb-move{transition:opacity 150ms ease}
  .sortb-geo{transition:opacity 150ms ease}
  .sortb-draw{animation:none;stroke-dashoffset:0}
  .sortb-pop{animation:none}
}`;

/** Put once inside every custom SVG that uses sortb-* classes. */
export function SortBStyle({ roughId }: { roughId?: string }) {
  return (
    <>
      <style>{CSS}</style>
      {roughId && (
        <defs>
          <filter id={roughId} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="2.4" />
          </filter>
        </defs>
      )}
    </>
  );
}

/** Deterministic tiny RNG so hand-drawn wobble is stable between renders. */
function rng(seed: number) {
  let s = (Math.abs(seed * 9301 + 49297) % 233280) || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** A slightly wobbly, hand-drawn rectangle outline path. */
export function sketchRect(x: number, y: number, w: number, h: number, seed = 1, j = 1.4) {
  const r = rng(seed);
  const J = () => (r() - 0.5) * 2 * j;
  const p = [
    [x + J(), y + J()],
    [x + w + J(), y + J()],
    [x + w + J(), y + h + J()],
    [x + J(), y + h + J()],
  ];
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let k = 0; k < 4; k++) {
    const a = p[k];
    const b = p[(k + 1) % 4];
    const mx = (a[0] + b[0]) / 2 + J();
    const my = (a[1] + b[1]) / 2 + J();
    d += ` Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return d + ' Z';
}

/** Open-top container ("bin"/"tray") with a hand-drawn feel. */
export function sketchBin(x: number, y: number, w: number, h: number, seed = 1) {
  const r = rng(seed);
  const J = () => (r() - 0.5) * 2.2;
  const rr = 9;
  return [
    `M${x - 5 + J()} ${y + J()} L${x + J() * 0.4} ${y + 4}`,
    `L${x + J()} ${y + h - rr}`,
    `Q${x + J()} ${y + h + J()} ${x + rr} ${y + h + J() * 0.5}`,
    `L${x + w - rr} ${y + h + J() * 0.5}`,
    `Q${x + w + J()} ${y + h + J()} ${x + w + J()} ${y + h - rr}`,
    `L${x + w + J() * 0.4} ${y + 4} L${x + w + 5 + J()} ${y + J()}`,
  ].join(' ');
}

/** Two nested groups: X eases out, Y eases in-out → moving items travel along a gentle arc. */
export function Glide({ x, y, opacity = 1, children }: { x: number; y: number; opacity?: number; children: ReactNode }) {
  return (
    <g className="sortb-x" style={{ transform: `translate(${x}px, 0px)`, opacity }}>
      <g className="sortb-y" style={{ transform: `translate(0px, ${y}px)` }}>
        {children}
      </g>
    </g>
  );
}

/** Tile body: rounded cell painted with a tone (idle = dark paper-outlined cell). */
export function TileBody({ w, h, tone, children, rx = 9 }: { w: number; h: number; tone?: Tone; children?: ReactNode; rx?: number }) {
  const idle = !tone || tone === 'idle';
  return (
    <>
      <rect
        className="sortb-paint"
        width={w}
        height={h}
        rx={rx}
        style={{ fill: idle ? 'var(--ink-3)' : toneFill(tone), stroke: idle ? 'var(--line-strong)' : 'rgba(255,255,255,0.08)' }}
        strokeWidth={1}
      />
      {children}
    </>
  );
}

export const inkOf = (tone?: Tone) => toneInk(tone ?? 'idle');

/** Pointer badge with a little arrow; `up` = sits above its target and points down. */
export function Caret({ x, y, label, tone = 'active', up = true, hidden = false }: { x: number; y: number; label: string; tone?: Tone; up?: boolean; hidden?: boolean }) {
  const w = Math.max(22, label.length * 7.6 + 14);
  const d = up ? 1 : -1;
  return (
    <g className="sortb-move" style={{ transform: `translate(${x}px, ${y}px)`, opacity: hidden ? 0 : 1 }}>
      <path d={`M0 0 L-5 ${-d * 7} L5 ${-d * 7} Z`} style={{ fill: toneFill(tone) }} />
      <rect x={-w / 2} y={up ? -26 : 7} width={w} height={19} rx={9.5} style={{ fill: toneFill(tone) }} />
      <text className="sortb-val" x={0} y={up ? -12.5 : 20.5} fontSize={11.5} style={{ fill: toneInk(tone) }}>
        {label}
      </text>
    </g>
  );
}

/** Text parser for the sorting inputs with friendly, specific errors. */
export function parseSortList(text: string, o: { min?: number; max?: number; maxLen?: number } = {}) {
  const { min = -99, max = 999, maxLen = 16 } = o;
  if (!text.trim()) throw new Error('Type a few numbers separated by commas, e.g. "5, 2, 9, 1".');
  try {
    return parseNumberList(text, { min, max, minLen: 1, maxLen });
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith('Values must')) throw new Error(`${m} (keeps the tiles readable)`);
    if (m.startsWith('At most')) throw new Error(`At most ${maxLen} values — more would make the animation too cramped.`);
    throw e;
  }
}

export const listText = (a: number[]) => `[${a.join(', ')}]`;
