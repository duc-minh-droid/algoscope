import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { parseNumberList, randInt } from '@/core/utils';
import { Callout, StatRow, VizRow, VizSection, VizStack, toneFill, toneInk } from '@/viz';

interface Input {
  a: number;
  b: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A run of `count` equal squares laid along one axis (count = 1 for individually carved squares). */
interface Carve {
  id: string;
  x: number;
  y: number;
  side: number;
  count: number;
  axis: 'x' | 'y';
  step: number;
}

interface Row {
  a: number;
  b: number;
  q: number;
  r?: number; // undefined while the row is still being written
}

interface State {
  A: number;
  B: number;
  a: number;
  b: number;
  step: number; // current iteration (0-based), -1 before the loop
  carves: Carve[];
  ghost: Carve | null; // dashed preview of the squares about to be carved
  region: Rect | null; // what's left of the rectangle
  regionTone: Tone;
  rows: Row[];
  gcd: number | null;
}

const MAX_SINGLE = 8; // carve up to this many squares one frame each; bigger runs go in one frame

function* run({ a: A, b: B }: Input): Generator<Frame<State>> {
  let a = A;
  let b = B;
  let region: Rect = { x: 0, y: 0, w: A, h: B };
  const carves: Carve[] = [];
  const rows: Row[] = [];
  const snap = (p: Partial<State>): State =>
    structuredClone({ A, B, a, b, step: -1, carves, ghost: null, region, regionTone: 'frontier' as Tone, rows, gcd: null, ...p });

  yield {
    state: snap({}),
    line: 'fn',
    note: `Picture **${A} × ${B}** as a rectangle. Its gcd is the side of the **largest square tile** that covers it exactly — Euclid finds it by repeatedly cutting off the biggest squares that fit.`,
    vars: { a, b, q: undefined, r: undefined },
    phase: 'setup',
  };

  let step = 0;
  while (true) {
    if (b === 0) break;
    yield {
      state: snap({ step, regionTone: 'active' }),
      line: 'loop',
      note: step === 0 ? `\`b = ${b}\` is not 0, so there's still a side to cut with. Enter the loop.` : `\`b = ${b}\` is still not 0 — a **${a} × ${b}** strip remains, keep cutting.`,
      vars: { a, b, q: undefined, r: undefined },
      phase: `step ${step + 1}`,
    };
    const q = Math.floor(a / b);
    const r = a % b;
    const axis: 'x' | 'y' = region.w === a && region.h === b ? 'x' : 'y';
    const at = (k: number) => (axis === 'x' ? { x: region.x + k * b, y: region.y } : { x: region.x, y: region.y + k * b });
    rows.push({ a, b, q });
    const ghost: Carve | null = q ? { id: `g${step}`, ...at(0), side: b, count: q, axis, step } : null;
    yield {
      state: snap({ step, ghost, regionTone: 'active' }),
      line: 'div',
      note:
        q === 0
          ? `\`${a} ÷ ${b}\` → **q = 0**: the side ${b} is longer than ${a}, so no ${b}×${b} square fits. This round just swaps the two numbers.`
          : `How many **${b} × ${b}** squares fit along the ${a} side? \`${a} ÷ ${b}\` → **q = ${q}**.`,
      vars: { a, b, q, r: undefined },
      phase: `step ${step + 1}`,
    };
    if (q > 0 && q <= MAX_SINGLE) {
      for (let k = 0; k < q; k++) {
        carves.push({ id: `s${step}-${k}`, ...at(k), side: b, count: 1, axis, step });
        yield {
          state: snap({ step, ghost, regionTone: 'active' }),
          line: 'div',
          note: `Cut square **${k + 1} of ${q}** (side ${b}).${k === q - 1 ? ` That's ${q} × ${b} = **${q * b}** of the ${a} used up.` : ''}`,
          vars: { a, b, q, r: undefined },
          phase: `step ${step + 1}`,
        };
      }
    } else if (q > MAX_SINGLE) {
      carves.push({ id: `s${step}`, ...at(0), side: b, count: q, axis, step });
      yield {
        state: snap({ step, ghost, regionTone: 'active' }),
        line: 'div',
        note: `Cut all **${q}** squares of side ${b} in one go — division does in one operation what repeated subtraction would need ${q} steps for.`,
        vars: { a, b, q, r: undefined },
        phase: `step ${step + 1}`,
      };
    }
    region = axis === 'x' ? { x: region.x + q * b, y: region.y, w: r, h: b } : { x: region.x, y: region.y + q * b, w: b, h: r };
    rows[rows.length - 1] = { a, b, q, r };
    yield {
      state: snap({ step, regionTone: 'frontier' }),
      line: 'mod',
      note:
        r === 0
          ? `\`${a} = ${q}·${b} + 0\` — the squares fit **exactly**, nothing is left over.`
          : `What's left is a **${r} × ${b}** strip: \`r = ${a} − ${q}·${b} = ${r}\`. Anything that tiles both ${a} and ${b} must also tile this leftover.`,
      vars: { a, b, q, r },
      phase: `step ${step + 1}`,
    };
    const [pa, pb] = [a, b];
    [a, b] = [b, r];
    yield {
      state: snap({ step, regionTone: 'active' }),
      line: 'shift',
      note: r === 0 ? `Shift: \`a = ${pb}\`, \`b = 0\`. The last square size, **${pb}**, is our candidate.` : `Shift: \`(a, b) = (${pb}, ${r})\`. The problem shrank from ${pa} × ${pb} to the **${pb} × ${r}** leftover — same gcd, smaller numbers.`,
      vars: { a, b, q, r },
      phase: `step ${step + 1}`,
    };
    step++;
  }
  yield {
    state: snap({ step }),
    line: 'loop',
    note: `\`b = 0\` — the loop stops after **${step}** round${step > 1 ? 's' : ''}.`,
    vars: { a, b, q: undefined, r: undefined },
    phase: 'result',
  };
  yield {
    state: snap({ step, gcd: a }),
    line: 'done',
    note:
      a === 1
        ? `Return **1**: ${A} and ${B} are **coprime** — only a 1×1 tile covers the rectangle exactly.`
        : `Return **${a}**. The smallest squares (${a} × ${a}) tile every earlier square, so they tile the whole ${A} × ${B} rectangle: **gcd = ${a}**.`,
    vars: { a, b, q: undefined, r: undefined },
    phase: 'result',
  };
}

/* ---------------- view ---------------- */

const STYLE = `
.euclid-gcd-sq { transform-box: fill-box; transform-origin: center; animation: euclid-gcd-pop calc(var(--step-ms) * 1.1) var(--ease-out) both; }
.euclid-gcd-ink { stroke-dasharray: 1; animation: euclid-gcd-draw calc(var(--step-ms) * 1.3) var(--ease-out) both; }
.euclid-gcd-row { animation: euclid-gcd-in calc(var(--step-ms) * 0.9) var(--ease-out) both; }
.euclid-gcd-ghost { stroke-dasharray: 6 5; animation: euclid-gcd-march 1.2s linear infinite; }
.euclid-gcd-region { transition: x var(--step-ms) var(--ease-in-out), y var(--step-ms) var(--ease-in-out), width var(--step-ms) var(--ease-in-out), height var(--step-ms) var(--ease-in-out), stroke var(--step-ms) ease; }
@keyframes euclid-gcd-pop { from { opacity: 0; transform: scale(0.82) rotate(-3deg); } }
@keyframes euclid-gcd-draw { from { stroke-dashoffset: 1; } }
@keyframes euclid-gcd-in { from { opacity: 0; transform: translateX(-10px); } }
@keyframes euclid-gcd-march { to { stroke-dashoffset: -22; } }
@media (prefers-reduced-motion: reduce) { .euclid-gcd-sq, .euclid-gcd-ink, .euclid-gcd-row, .euclid-gcd-ghost { animation: none; } }
`;

const FIT_W = 560;
const FIT_H = 330;

function Board({ s }: { s: State }) {
  const scale = Math.min(FIT_W / s.A, FIT_H / s.B);
  const pad = 16;
  const W = s.A * scale + pad * 2;
  const H = Math.max(s.B * scale, 24) + pad * 2;
  const X = (v: number) => pad + v * scale;
  const Y = (v: number) => pad + v * scale;
  const finalStep = s.gcd !== null ? s.rows.length - 1 : -1;
  const fillFor = (c: Carve): { fill: string; opacity: number; tone: Tone } => {
    if (c.step === finalStep) return { fill: toneFill('found'), opacity: 0.9, tone: 'found' };
    if (c.step === s.step && s.gcd === null) return { fill: toneFill('active'), opacity: 0.9, tone: 'active' };
    return { fill: toneFill('visited'), opacity: c.step % 2 ? 0.28 : 0.45, tone: 'visited' };
  };
  const pieces: { key: string; x: number; y: number; side: number; carve: Carve }[] = [];
  const strips: Carve[] = [];
  for (const c of s.carves) {
    if (c.count === 1 || (c.side * scale >= 5 && c.count <= 200)) {
      for (let k = 0; k < c.count; k++)
        pieces.push({ key: c.count === 1 ? c.id : `${c.id}-${k}`, x: c.axis === 'x' ? c.x + k * c.side : c.x, y: c.axis === 'y' ? c.y + k * c.side : c.y, side: c.side, carve: c });
    } else strips.push(c);
  }
  const g = s.gcd;
  const gridLines = g !== null && s.A / g + s.B / g <= 140 && g * scale >= 3;
  const wobble = (x: number, y: number, w: number, h: number) =>
    `M${x + 1} ${y + 0.5} Q${x + w / 2} ${y - 1.2} ${x + w - 0.5} ${y + 1} Q${x + w + 1} ${y + h / 2} ${x + w - 1} ${y + h - 0.5} Q${x + w / 2} ${y + h + 1.2} ${x + 0.5} ${y + h - 1} Q${x - 1} ${y + h / 2} ${x + 1} ${y + 0.5}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.4, display: 'block', margin: '0 auto', overflow: 'visible' }} role="img" aria-label="rectangle tiled by squares">
      <style>{STYLE}</style>
      <defs>
        <pattern id="euclid-gcd-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--paper-dim)" strokeWidth="1.2" strokeOpacity="0.5" />
        </pattern>
      </defs>
      {/* paper */}
      <rect x={X(0)} y={Y(0)} width={s.A * scale} height={Math.max(s.B * scale, 1)} fill="var(--ink-2)" stroke="var(--line-strong)" strokeWidth={1.5} rx={2} />
      {/* carved squares */}
      {pieces.map(({ key, x, y, side, carve }) => {
        const f = fillFor(carve);
        const px = side * scale;
        return (
          <g key={key} className="euclid-gcd-sq">
            <rect x={X(x)} y={Y(y)} width={px} height={px} style={{ fill: f.fill, fillOpacity: f.opacity, transition: 'fill var(--step-ms) ease, fill-opacity var(--step-ms) ease' }} />
            {px >= 6 && <path className="euclid-gcd-ink" pathLength={1} d={wobble(X(x), Y(y), px, px)} fill="none" stroke="var(--ink-0)" strokeWidth={Math.min(2, px / 8)} strokeLinejoin="round" />}
            {px >= 30 && (
              <text x={X(x) + px / 2} y={Y(y) + px / 2 + 5} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={Math.min(16, px / 3.2)} style={{ fill: f.tone === 'visited' ? 'var(--paper)' : toneInk(f.tone) }}>
                {side}
              </text>
            )}
          </g>
        );
      })}
      {strips.map((c) => {
        const f = fillFor(c);
        const w = (c.axis === 'x' ? c.side * c.count : c.side) * scale;
        const h = (c.axis === 'y' ? c.side * c.count : c.side) * scale;
        return (
          <g key={c.id} className="euclid-gcd-sq">
            <rect x={X(c.x)} y={Y(c.y)} width={Math.max(w, 1)} height={Math.max(h, 1)} style={{ fill: f.fill, fillOpacity: f.opacity }} />
            <rect x={X(c.x)} y={Y(c.y)} width={Math.max(w, 1)} height={Math.max(h, 1)} fill="url(#euclid-gcd-hatch)" />
            {w > 60 && h > 18 && (
              <text x={X(c.x) + w / 2} y={Y(c.y) + h / 2 + 5} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={13} style={{ fill: toneInk(f.tone === 'visited' ? 'active' : f.tone) }}>
                {c.count} × {c.side}²
              </text>
            )}
          </g>
        );
      })}
      {/* gcd grid: the final tile covers everything */}
      {gridLines && g !== null && (
        <g stroke={toneFill('found')} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 3" className="euclid-gcd-row">
          {Array.from({ length: s.A / g - 1 }, (_, k) => (
            <line key={`v${k}`} x1={X((k + 1) * g)} x2={X((k + 1) * g)} y1={Y(0)} y2={Y(s.B)} />
          ))}
          {Array.from({ length: s.B / g - 1 }, (_, k) => (
            <line key={`h${k}`} y1={Y((k + 1) * g)} y2={Y((k + 1) * g)} x1={X(0)} x2={X(s.A)} />
          ))}
        </g>
      )}
      {/* ghost preview of the squares about to be cut */}
      {s.ghost &&
        (s.ghost.count <= 200 && s.ghost.side * scale >= 5 ? (
          Array.from({ length: s.ghost.count }, (_, k) => {
            const gh = s.ghost!;
            const x = gh.axis === 'x' ? gh.x + k * gh.side : gh.x;
            const y = gh.axis === 'y' ? gh.y + k * gh.side : gh.y;
            return <rect key={`${gh.id}-${k}`} className="euclid-gcd-ghost" x={X(x) + 2} y={Y(y) + 2} width={gh.side * scale - 4} height={gh.side * scale - 4} rx={3} fill="none" stroke={toneFill('active')} strokeWidth={1.5} />;
          })
        ) : (
          <rect
            className="euclid-gcd-ghost"
            x={X(s.ghost.x)}
            y={Y(s.ghost.y)}
            width={Math.max(1, (s.ghost.axis === 'x' ? s.ghost.side * s.ghost.count : s.ghost.side) * scale)}
            height={Math.max(1, (s.ghost.axis === 'y' ? s.ghost.side * s.ghost.count : s.ghost.side) * scale)}
            fill="none"
            stroke={toneFill('active')}
            strokeWidth={1.5}
          />
        ))}
      {/* what's left */}
      {s.region && s.region.w > 0 && s.region.h > 0 && s.gcd === null && (
        <rect
          className="euclid-gcd-region"
          x={X(s.region.x)}
          y={Y(s.region.y)}
          width={Math.max(1.5, s.region.w * scale)}
          height={Math.max(1.5, s.region.h * scale)}
          fill={toneFill(s.regionTone)}
          fillOpacity={0.1}
          stroke={toneFill(s.regionTone)}
          strokeWidth={2.5}
          strokeDasharray={s.regionTone === 'frontier' ? '7 5' : undefined}
        />
      )}
      {/* dimension labels */}
      <text x={X(s.A / 2)} y={pad - 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={12} fill="var(--paper-faint)">
        {s.A}
      </text>
      <text x={pad - 5} y={Y(s.B / 2)} textAnchor="end" dominantBaseline="middle" fontFamily="var(--font-mono)" fontSize={12} fill="var(--paper-faint)">
        {s.B}
      </text>
    </svg>
  );
}

const C = { q: toneFill('active'), b: toneFill('visited'), r: toneFill('frontier') };

function Ladder({ rows, current, done }: { rows: Row[]; current: number; done: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 15, minWidth: 0 }}>
      {rows.length === 0 && <span style={{ color: 'var(--paper-faint)', fontStyle: 'italic', fontSize: 13 }}>rows appear as the loop runs…</span>}
      {rows.map((r, k) => {
        const hot = k === current && !done;
        const last = done && k === rows.length - 1;
        return (
          <div
            key={k}
            className="euclid-gcd-row"
            style={{
              display: 'flex',
              gap: 7,
              alignItems: 'baseline',
              padding: '4px 10px',
              borderRadius: 8,
              background: hot ? 'var(--ink-3)' : 'transparent',
              borderLeft: `3px solid ${hot ? C.q : last ? toneFill('found') : 'transparent'}`,
              opacity: hot || done || k === current ? 1 : 0.6,
              transition: 'opacity var(--step-ms) ease, background-color var(--step-ms) ease',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: 'var(--paper)' }}>{r.a}</span>
            <span style={{ color: 'var(--paper-faint)' }}>=</span>
            <span style={{ color: C.q, fontWeight: 700 }}>{r.q}</span>
            <span style={{ color: 'var(--paper-faint)' }}>·</span>
            <span style={{ color: last ? toneFill('found') : C.b, fontWeight: last ? 700 : 400 }}>{r.b}</span>
            <span style={{ color: 'var(--paper-faint)' }}>+</span>
            <span style={{ color: r.r === undefined ? 'var(--paper-faint)' : C.r, fontWeight: 700 }}>{r.r === undefined ? '?' : r.r}</span>
          </div>
        );
      })}
    </div>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const done = s.gcd !== null;
  return (
    <VizStack gap={20}>
      <StatRow
        stats={[
          { label: 'a', value: s.a },
          { label: 'b', value: s.b, tone: 'visited' },
          { label: 'rounds', value: s.rows.length },
          { label: 'squares cut', value: s.carves.reduce((t, c) => t + c.count, 0) },
        ]}
      />
      <VizRow gap={24}>
        <div style={{ flex: '3 1 340px', minWidth: 0 }}>
          <VizSection label={`${s.A} × ${s.B} rectangle`} aside="cut the biggest squares that fit">
            <Board s={s} />
          </VizSection>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <VizSection label="a = q · b + r">
            <Ladder rows={s.rows} current={s.step} done={done} />
          </VizSection>
        </div>
      </VizRow>
      <Callout show={done} tone="found">
        gcd({s.A}, {s.B}) = {s.gcd ?? '?'}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const dur = '4.5s';
  const sq: [number, number, number, string, number][] = [
    [15, 13, 54, 'currentColor', 0.1],
    [69, 13, 36, '#6cb6ff', 0.3],
    [69, 49, 18, '#c6f36b', 0.5],
    [87, 49, 18, '#c6f36b', 0.65],
  ];
  return (
    <svg viewBox="0 0 120 80">
      <rect x={15} y={13} width={90} height={54} rx={2} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} />
      {sq.map(([x, y, s, c, t], k) => (
        <rect key={k} x={x + 1} y={y + 1} width={s - 2} height={s - 2} rx={2} fill={c} fillOpacity={0.75} opacity={0}>
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes={`0;${t};${t + 0.08};0.92;1`} dur={dur} repeatCount="indefinite" />
        </rect>
      ))}
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'euclid-gcd',
  name: "Euclid's GCD",
  category: 'basic',
  order: 2,
  tagline: 'Replace (a, b) by (b, a mod b) until the remainder is zero.',
  description:
    'The greatest common divisor is the largest number dividing both `a` and `b`. Euclid noticed that any common divisor of `a` and `b` also divides the remainder `a mod b` — so the problem can shrink to `(b, a mod b)` without changing the answer. Geometrically: keep cutting the **largest squares** out of an `a × b` rectangle; the last square size tiles everything.',
  howItWorks: [
    'While `b` is not zero, divide: `a = q·b + r`.',
    'Geometrically, cut `q` squares of side `b` from the rectangle, leaving an `r × b` strip.',
    'Every tile that fits `a` and `b` also fits `r`, so continue with `(b, r)`.',
    'When `r` hits 0 the squares fit exactly — the last `b` (now `a`) is the gcd.',
  ],
  complexity: { time: 'O(log min(a, b))', space: 'O(1)', note: 'Worst case is consecutive Fibonacci numbers, where every quotient is 1 (Lamé’s theorem).' },
  code: {
    js: `
function gcd(a, b) { //@fn
  while (b !== 0) { //@loop
    const q = Math.floor(a / b); //@div
    const r = a % b; // = a - q * b //@mod
    [a, b] = [b, r]; //@shift
  }
  return a; //@done
}`,
    py: `
def gcd(a, b): #@fn
    while b != 0: #@loop
        q = a // b #@div
        r = a % b  # = a - q * b #@mod
        a, b = b, r #@shift
    return a #@done`,
  },
  input: {
    default: { a: 1386, b: 525 },
    presets: [
      { name: 'Coprime 25, 9', value: { a: 25, b: 9 } },
      { name: 'Equal numbers', value: { a: 42, b: 42 } },
      { name: 'One divides the other', value: { a: 15, b: 60 } },
      { name: 'Fibonacci neighbours', value: { a: 144, b: 89 } },
    ],
    random: () => {
      const g = randInt(1, 24);
      let a = g * randInt(2, 40);
      let b = g * randInt(2, 40);
      if (a === b) b += g;
      if (Math.random() < 0.3) [a, b] = [b, a];
      return { a, b };
    },
    format: (v) => `${v.a}, ${v.b}`,
    parse: (text) => {
      const [a, b] = parseNumberList(text, { min: 1, max: 9999, minLen: 2, maxLen: 2 });
      return { a, b };
    },
    placeholder: '1386, 525',
    hint: 'Two positive whole numbers "a, b", each 1–9999. Try consecutive Fibonacci numbers for the worst case.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'squares being cut / current strip' },
    { tone: 'frontier', label: 'leftover (remainder)' },
    { tone: 'visited', label: 'cut in earlier rounds' },
    { tone: 'found', label: 'gcd-sized squares' },
  ],
  Glyph,
});
