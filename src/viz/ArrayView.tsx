import type { Tone } from '@/core/types';
import type { Item } from '@/core/utils';
import { readTone, toneFill, toneInk, type ToneMap } from './tones';

export interface Pointer {
  index: number;
  label: string;
  tone?: Tone;
  side?: 'top' | 'bottom';
}

export interface Span {
  from: number;
  to: number; // inclusive
  label?: string;
  tone?: Tone;
  side?: 'top' | 'bottom';
}

export interface ArrayViewProps {
  /** Plain values (positional) or Items with stable ids (movement animates by id). */
  items: (number | string | Item<number | string>)[];
  variant?: 'cells' | 'bars';
  tones?: ToneMap<number>;
  pointers?: Pointer[];
  spans?: Span[];
  /** Per-index offset, e.g. lift the key in insertion sort: { 3: { dy: -60 } }. */
  offsets?: Record<number, { dx?: number; dy?: number }>;
  /** Small caption under each cell (index shown when omitted). Return '' to hide. */
  caption?: (index: number) => string;
  showIndices?: boolean;
  cell?: number;
  gap?: number;
  barHeight?: number;
  /** Fix the bar scale (defaults to max |value|). */
  maxValue?: number;
  /** Faint empty slots rendered behind items (e.g. auxiliary arrays of fixed length). */
  slots?: number;
  /** Reserve vertical room (px) for offsets so the layout doesn't jump between frames. */
  reserveLift?: number;
  reserveDrop?: number;
  className?: string;
  title?: string;
}

const PTR_H = 30;
const SPAN_H = 26;

export function ArrayView({
  items,
  variant = 'cells',
  tones,
  pointers = [],
  spans = [],
  offsets = {},
  caption,
  showIndices = true,
  cell = 52,
  gap = 8,
  barHeight = 170,
  maxValue,
  slots,
  reserveLift = 0,
  reserveDrop = 0,
  className,
  title,
}: ArrayViewProps) {
  const norm = items.map((it, i) => (typeof it === 'object' ? it : { id: `p${i}`, value: it }));
  const n = Math.max(norm.length, slots ?? 0, 1);
  const pad = 14;
  const stride = cell + gap;

  const topStack = stackLevels(pointers.filter((p) => (p.side ?? 'top') === 'top'));
  const botStack = stackLevels(pointers.filter((p) => p.side === 'bottom'));
  const topSpans = spans.filter((s) => s.side === 'top');
  const botSpans = spans.filter((s) => s.side !== 'top');
  const liftMax = Math.max(reserveLift, ...Object.values(offsets).map((o) => -(o.dy ?? 0)));
  const dropMax = Math.max(reserveDrop, ...Object.values(offsets).map((o) => o.dy ?? 0));

  const topH = topStack.depth * PTR_H + topSpans.length * SPAN_H + liftMax + (topStack.depth || topSpans.length ? 6 : 0);
  const nums = norm.map((d) => (typeof d.value === 'number' ? d.value : 0));
  const posMax = Math.max(0, ...nums, maxValue ?? 0);
  const negMax = Math.max(0, ...nums.map((v) => -v));
  const bodyH = variant === 'bars' ? barHeight : cell;
  const zeroY = variant === 'bars' ? (bodyH * posMax) / Math.max(1, posMax + negMax) : 0;
  const scale = variant === 'bars' ? bodyH / Math.max(1, posMax + negMax) : 0;
  const captionH = showIndices || caption ? 20 : 0;
  const botH = captionH + botStack.depth * PTR_H + botSpans.length * SPAN_H + dropMax + 8;

  const W = pad * 2 + n * stride - gap;
  const H = topH + bodyH + botH + 4;
  const bodyTop = topH;
  const xOf = (i: number) => pad + i * stride;

  return (
    <svg
      className={`av ${className ?? ''}`}
      viewBox={`0 0 ${W} ${H}`}
      style={{ maxWidth: W * 1.5, maxHeight: H * 1.5 }}
      role="img"
      aria-label={title ?? 'array'}
    >
      {slots !== undefined &&
        Array.from({ length: slots }, (_, i) => (
          <rect key={`s${i}`} className="av-slot" x={xOf(i)} y={bodyTop} width={cell} height={variant === 'bars' ? bodyH : cell} rx={8} />
        ))}
      {variant === 'bars' && negMax > 0 && (
        <line className="av-zero" x1={pad - 6} x2={W - pad + 6} y1={bodyTop + zeroY} y2={bodyTop + zeroY} />
      )}

      {norm.map((it, i) => {
        const tone = readTone(tones, i) ?? 'idle';
        const off = offsets[i] ?? {};
        const x = xOf(i) + (off.dx ?? 0);
        const y = bodyTop + (off.dy ?? 0);
        const v = it.value;
        const label = String(v);
        const fs = label.length > 3 ? cell * 0.28 : cell * 0.36;
        if (variant === 'bars') {
          const num = typeof v === 'number' ? v : 0;
          const h = Math.max(4, Math.abs(num) * scale);
          const by = num >= 0 ? zeroY - h : zeroY;
          return (
            <g key={it.id} className="av-item" style={{ transform: `translate(${x}px, ${y}px)` }} data-tone={tone}>
              <rect className="av-bar" x={0} y={by} width={cell} height={h} rx={Math.min(8, cell / 5)} fill={toneFill(tone)} />
              <text className="av-val" x={cell / 2} y={num >= 0 ? by - 7 : by + h + 15} fontSize={Math.min(15, fs)}>
                {label}
              </text>
            </g>
          );
        }
        return (
          <g key={it.id} className="av-item" style={{ transform: `translate(${x}px, ${y}px)` }} data-tone={tone}>
            <rect className="av-cell" width={cell} height={cell} rx={10} fill={toneFill(tone)} />
            <text className="av-val" x={cell / 2} y={cell / 2 + fs * 0.36} fontSize={fs} fill={toneInk(tone)}>
              {label}
            </text>
          </g>
        );
      })}

      {captionH > 0 &&
        Array.from({ length: n }, (_, i) => {
          const c = caption ? caption(i) : String(i);
          return c ? (
            <text key={`c${i}`} className="av-idx" x={xOf(i) + cell / 2} y={bodyTop + bodyH + 15}>
              {c}
            </text>
          ) : null;
        })}

      {topSpans.map((s, k) => (
        <SpanMark key={`ts${k}`} s={s} x0={xOf(s.from)} x1={xOf(s.to) + cell} y={topH - 6 - k * SPAN_H - liftMax} up />
      ))}
      {botSpans.map((s, k) => (
        <SpanMark key={`bs${k}`} s={s} x0={xOf(s.from)} x1={xOf(s.to) + cell} y={bodyTop + bodyH + captionH + 4 + dropMax + k * SPAN_H} />
      ))}

      {pointers.map((p) => {
        const side = p.side ?? 'top';
        const lvl = (side === 'top' ? topStack : botStack).level.get(p) ?? 0;
        const cx = xOf(Math.max(0, Math.min(n - 1, p.index))) + cell / 2;
        const baseY =
          side === 'top'
            ? topH - topSpans.length * SPAN_H - liftMax - 4 - lvl * PTR_H
            : bodyTop + bodyH + captionH + botSpans.length * SPAN_H + dropMax + 4 + lvl * PTR_H;
        return (
          <g
            key={`ptr-${side}-${p.label}`}
            className="av-ptr"
            style={{ transform: `translate(${cx}px, ${baseY}px)`, opacity: p.index < 0 || p.index >= n ? 0 : 1 }}
          >
            <PointerGlyph label={p.label} tone={p.tone ?? 'active'} up={side === 'top'} />
          </g>
        );
      })}
    </svg>
  );
}

function PointerGlyph({ label, tone, up }: { label: string; tone: Tone; up: boolean }) {
  const w = Math.max(22, label.length * 8 + 14);
  const dir = up ? 1 : -1;
  return (
    <g>
      <path d={`M0 ${dir * 0} L-5 ${-dir * 7} L5 ${-dir * 7} Z`} fill={toneFill(tone)} />
      <rect x={-w / 2} y={up ? -26 : 7} width={w} height={19} rx={9.5} fill={toneFill(tone)} />
      <text className="av-ptr-t" x={0} y={up ? -12.5 : 20.5} fill={toneInk(tone)}>
        {label}
      </text>
    </g>
  );
}

function SpanMark({ s, x0, x1, y, up }: { s: Span; x0: number; x1: number; y: number; up?: boolean }) {
  const d = up ? -1 : 1;
  const c = toneFill(s.tone ?? 'frontier');
  return (
    <g className="av-span" style={{ transform: `translate(0px, ${y}px)` }}>
      <path
        d={`M${x0 + 2} ${-d * 5} L${x0 + 2} 0 L${x1 - 2} 0 L${x1 - 2} ${-d * 5}`}
        fill="none"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {s.label && (
        <text className="av-span-t" x={(x0 + x1) / 2} y={d * 14} fill={c}>
          {s.label}
        </text>
      )}
    </g>
  );
}

function stackLevels(ps: Pointer[]) {
  const level = new Map<Pointer, number>();
  const used = new Map<number, number>();
  for (const p of ps) {
    const l = used.get(p.index) ?? 0;
    level.set(p, l);
    used.set(p.index, l + 1);
  }
  // Reserve room for two stacked pointers whenever there are 2+ so the layout doesn't jump as they meet.
  return { level, depth: Math.max(Math.min(ps.length, 2), ...used.values()) };
}
