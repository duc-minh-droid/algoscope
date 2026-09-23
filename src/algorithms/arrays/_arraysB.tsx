import type { CSSProperties } from 'react';

/**
 * Helpers shared by quickselect / boyer-moore-majority / two-pointers.
 * `avGeom` mirrors ArrayView's horizontal layout (pad 14, stride cell+gap, maxWidth W*1.5) so a custom
 * SVG "lane" rendered right below an ArrayView lines up column-for-column at any container width.
 */
export function avGeom(n: number, cell = 52, gap = 8) {
  const pad = 14;
  const stride = cell + gap;
  const count = Math.max(n, 1);
  const W = pad * 2 + count * stride - gap;
  const xOf = (i: number) => pad + i * stride;
  const style: CSSProperties = { display: 'block', width: '100%', maxWidth: W * 1.5, margin: '0 auto', overflow: 'visible' };
  return { W, xOf, cx: (i: number) => xOf(i) + cell / 2, cell, stride, style };
}

/** Tiny deterministic pseudo-random in [-1, 1] — keeps "hand-drawn" wobble stable between renders. */
export const jitter = (seed: number) => {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/** A slightly wobbly straight stroke (two quadratic halves with offset control points). */
export function sketchLine(x1: number, y1: number, x2: number, y2: number, seed = 1, amp = 1.6) {
  const mx = (x1 + x2) / 2 + jitter(seed) * amp;
  const my = (y1 + y2) / 2 + jitter(seed + 1) * amp;
  const q1x = (x1 + mx) / 2 + jitter(seed + 2) * amp;
  const q1y = (y1 + my) / 2 + jitter(seed + 3) * amp;
  const q2x = (mx + x2) / 2 + jitter(seed + 4) * amp;
  const q2y = (my + y2) / 2 + jitter(seed + 5) * amp;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${q1x.toFixed(1)} ${q1y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)} Q${q2x.toFixed(1)} ${q2y.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** A hand-drawn arc from (x1,y) to (x2,y) bulging by `depth` (positive = downwards). */
export function sketchArc(x1: number, x2: number, y: number, depth: number, seed = 1) {
  const mx = (x1 + x2) / 2 + jitter(seed) * 3;
  const c = y + depth + jitter(seed + 1) * 2;
  return `M${x1.toFixed(1)} ${(y + jitter(seed + 2)).toFixed(1)} Q${mx.toFixed(1)} ${c.toFixed(1)} ${x2.toFixed(1)} ${(y + jitter(seed + 3)).toFixed(1)}`;
}

/** Arrowhead (open chevron) at (x,y) pointing along angle `a` (radians). */
export function arrowHead(x: number, y: number, a: number, size = 8) {
  const l = (d: number) => `${(x - size * Math.cos(a - d)).toFixed(1)} ${(y - size * Math.sin(a - d)).toFixed(1)}`;
  return `M${l(0.5)} L${x.toFixed(1)} ${y.toFixed(1)} L${l(-0.5)}`;
}
