import type { CSSProperties } from 'react';
import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import type { Item } from '@/core/utils';
import { Callout, StatRow, toneFill, toneInk, VizStack } from '@/viz';
import { finalTone, listInput, sweepFronts } from './_sortA';

type Input = number[];
type Row = 'in' | 'cnt' | 'out';
interface Loc {
  row: Row;
  idx: number;
}
type Stage = 'init' | 'count' | 'prefix' | 'place' | 'done';

interface State {
  input: number[];
  counts: number[];
  out: (Item | null)[];
  used: boolean[]; // input elements already written to the output
  stage: Stage;
  src: number; // input index being read (-1)
  bucket: number; // count index being changed (-1)
  prev: number; // count index being added from (prefix phase, -1)
  dst: number; // output index being written (-1)
  flow: { from: Loc; to: Loc; tone: Tone; token: string } | null;
  tallies: number;
  adds: number;
  writes: number;
  sweep: number;
  finished: boolean;
}

function* run(a: Input): Generator<Frame<State>> {
  const n = a.length;
  const k = Math.max(...a) + 1;
  const counts = new Array<number>(k).fill(0);
  const out: (Item | null)[] = new Array(n).fill(null);
  const used = new Array<boolean>(n).fill(false);
  let tallies = 0;
  let adds = 0;
  let writes = 0;
  const S = (p: Partial<State>): State => ({
    input: [...a],
    counts: [...counts],
    out: out.map((o) => (o ? { ...o } : null)),
    used: [...used],
    stage: 'init',
    src: -1,
    bucket: -1,
    prev: -1,
    dst: -1,
    flow: null,
    tallies,
    adds,
    writes,
    sweep: -1,
    finished: false,
    ...p,
  });
  const V = (i?: number, x?: number, v?: number) => ({ k, i, x, v, count: [...counts] });

  yield {
    state: S({}),
    line: ['fn', 'alloc'],
    note: `No comparisons at all! The biggest value is **${k - 1}**, so we make a **count** array with one bucket per possible value, 0…${k - 1} (${k} buckets), all starting at 0.`,
    vars: V(),
    phase: 'count',
  };

  // 1. tally
  for (let i = 0; i < n; i++) {
    const x = a[i];
    counts[x]++;
    tallies++;
    yield {
      state: S({ stage: 'count', src: i, bucket: x, flow: { from: { row: 'in', idx: i }, to: { row: 'cnt', idx: x }, tone: 'swap', token: String(x) } }),
      line: 'count',
      note: `a[${i}] = **${x}** → drop a tally into bucket ${x}. **count[${x}]** goes up to **${counts[x]}**.`,
      vars: V(i, x),
      phase: 'count',
    };
  }

  // 2. prefix sums
  yield {
    state: S({ stage: 'prefix' }),
    line: 'prefixLoop',
    note: `Now we know how many of each value there are. A running total turns that into where each value ends: count[v] will become the number of elements **≤ v**.`,
    vars: V(),
    phase: 'prefix sum',
  };
  for (let v = 1; v < k; v++) {
    const before = counts[v];
    counts[v] += counts[v - 1];
    adds++;
    yield {
      state: S({ stage: 'prefix', bucket: v, prev: v - 1, flow: { from: { row: 'cnt', idx: v - 1 }, to: { row: 'cnt', idx: v }, tone: 'compare', token: `+${counts[v - 1]}` } }),
      line: 'prefix',
      note:
        before === 0
          ? `count[${v}] += count[${v - 1}] → **${counts[v]}**. There are no ${v}s, but ${counts[v]} element${counts[v] === 1 ? ' is' : 's are'} still ≤ ${v}.`
          : `count[${v}] = ${before} + ${counts[v - 1]} = **${counts[v]}**: ${counts[v]} elements are ≤ ${v}, so the ${v}s occupy slots up to index **${counts[v] - 1}**.`,
      vars: V(undefined, undefined, v),
      phase: 'prefix sum',
    };
  }

  // 3. place, right to left for stability
  for (let i = n - 1; i >= 0; i--) {
    const x = a[i];
    const c = counts[x];
    counts[x]--;
    yield {
      state: S({ stage: 'place', src: i, bucket: x, flow: { from: { row: 'in', idx: i }, to: { row: 'cnt', idx: x }, tone: 'active', token: String(x) } }),
      line: ['placeLoop', 'dec'],
      note:
        i === n - 1
          ? `Walk the input **right to left**. a[${i}] = **${x}**; count[${x}] = ${c} says ${c} elements ≤ ${x} are still unplaced, so this ${x} takes slot **${c - 1}**. Decrement count[${x}] to ${counts[x]}.`
          : `a[${i}] = **${x}**: count[${x}] was ${c}, so it goes to slot **${c - 1}** — decrement count[${x}] to **${counts[x]}**.`,
      vars: V(i, x),
      phase: 'place',
    };
    out[counts[x]] = { id: i, value: x };
    used[i] = true;
    writes++;
    const dupLater = a.slice(0, i).includes(x);
    yield {
      state: S({ stage: 'place', src: i, bucket: x, dst: counts[x], flow: { from: { row: 'in', idx: i }, to: { row: 'out', idx: counts[x] }, tone: 'swap', token: String(x) } }),
      line: 'place',
      note: dupLater
        ? `Write **${x}** into out[${counts[x]}]. Another ${x} sits further left in the input; it will land before this one — equal values keep their order, so the sort is **stable**.`
        : `Write **${x}** into **out[${counts[x]}]**.`,
      vars: V(i, x),
      phase: 'place',
    };
  }

  for (const f of sweepFronts(n)) {
    yield {
      state: S({ stage: 'done', sweep: f }),
      line: 'done',
      note: `Every element has been placed — the output is sorted.`,
      vars: V(),
      phase: 'done',
    };
  }
  yield {
    state: S({ stage: 'done', finished: true }),
    line: 'done',
    note: `Sorted with **0 comparisons**: ${n} tallies + ${adds} additions + ${n} writes. That's O(n + k) — unbeatable when the value range k is small.`,
    vars: V(),
    phase: 'done',
  };
}

// ---------- view ----------

const C = 36;
const G = 7;
const ST = C + G;
const PADX = 24;
const Y: Record<Row, number> = { in: 34, cnt: 158, out: 282 };

const CSS = `
.counting-sort-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:counting-sort-draw calc(var(--step-ms) * .8) var(--ease-out) forwards}
.counting-sort-head{opacity:0;animation:counting-sort-fade calc(var(--step-ms) * .25) var(--ease-out) calc(var(--step-ms) * .6) forwards}
.counting-sort-token{opacity:0;animation:counting-sort-fly var(--step-ms) var(--ease-in-out) forwards}
.counting-sort-tick{transform-box:fill-box;transform-origin:center;animation:counting-sort-pop calc(var(--step-ms) * .9) var(--ease-out)}
@keyframes counting-sort-draw{to{stroke-dashoffset:0}}
@keyframes counting-sort-fade{to{opacity:1}}
@keyframes counting-sort-fly{
  0%{transform:translate(var(--x0),var(--y0));opacity:1}
  50%{transform:translate(var(--xm),var(--ym));opacity:1}
  85%{opacity:1}
  100%{transform:translate(var(--x1),var(--y1));opacity:0}
}
@keyframes counting-sort-pop{0%{transform:scale(1.6);opacity:.4}100%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion: reduce){
  .counting-sort-draw{animation:none;stroke-dashoffset:0}
  .counting-sort-head{animation:none;opacity:1}
  .counting-sort-token{animation:none;opacity:0}
  .counting-sort-tick{animation:none}
}`;

function Cell({ x, y, tone, label, pop, corner }: { x: number; y: number; tone: Tone; label: string; pop?: string; corner?: string }) {
  const fs = label.length > 2 ? 12 : 15;
  return (
    <g className="av-item" data-tone={tone} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <rect className="av-cell" width={C} height={C} rx={8} fill={toneFill(tone)} />
      <text key={pop} className={`av-val${pop ? ' counting-sort-tick' : ''}`} x={C / 2} y={C / 2 + fs * 0.36} fontSize={fs} fill={toneInk(tone)}>
        {label}
      </text>
      {corner && (
        <text x={C - 4} y={10} fontSize={8.5} textAnchor="end" fill={toneInk(tone)} opacity={0.7} style={{ fontFamily: 'var(--font-mono)' }}>
          {corner}
        </text>
      )}
    </g>
  );
}

function View({ frame, index }: { frame: Frame<State>; index: number }) {
  const s = frame.state;
  const n = s.input.length;
  const k = s.counts.length;
  const cols = Math.max(n, k);
  const W = Math.max(420, cols * ST - G + PADX * 2);
  const H = Y.out + C + 34;
  const x0 = (len: number) => (W - (len * ST - G)) / 2;
  const cx = (row: Row, idx: number) => x0(row === 'cnt' ? k : n) + idx * ST;
  const over = s.stage === 'done';

  const inTone = (i: number): Tone => {
    if (s.used[i] && i !== s.src) return 'muted';
    if (i === s.src) return 'active';
    if (s.stage === 'count' && i < s.src) return 'visited';
    return 'idle';
  };
  const cntTone = (v: number): Tone => {
    if (v === s.bucket) return s.stage === 'prefix' ? 'active' : 'swap';
    if (v === s.prev) return 'compare';
    if (s.stage === 'prefix' && v < s.bucket) return 'visited';
    return 'idle';
  };
  const outTone = (i: number): Tone => {
    if (over) return finalTone(i, s.sweep);
    if (i === s.dst) return 'swap';
    return 'done';
  };

  const cntLabel =
    s.stage === 'prefix' || s.stage === 'place' || s.stage === 'done' ? 'count[v] → slots for values ≤ v' : 'count[v] — how many times v appears';

  // flow arrow + token
  let flow = null;
  if (s.flow && !over) {
    const f = s.flow;
    const P = (l: Loc, start: boolean) => {
      const x = cx(l.row, l.idx) + C / 2;
      if (l.row === 'cnt' && f.from.row === 'cnt') return { x, y: Y.cnt - 4 };
      if (start) return { x, y: Y[l.row] + C + 18 };
      return { x, y: Y[l.row] - 5 };
    };
    const p0 = P(f.from, true);
    const p1 = P(f.to, false);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const bend = f.from.row === f.to.row ? -0.9 : f.to.row === 'out' ? 0.22 : 0.25;
    const c = { x: (p0.x + p1.x) / 2 - dy * bend, y: (p0.y + p1.y) / 2 + dx * bend };
    const m = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
    const len = Math.hypot(p1.x - c.x, p1.y - c.y) || 1;
    const ux = (p1.x - c.x) / len;
    const uy = (p1.y - c.y) / len;
    const head = `M${p1.x} ${p1.y} L${p1.x - ux * 9 - uy * 5} ${p1.y - uy * 9 + ux * 5} L${p1.x - ux * 9 + uy * 5} ${p1.y - uy * 9 - ux * 5} Z`;
    const col = toneFill(f.tone);
    const tw = Math.max(26, f.token.length * 9 + 10);
    const vars = {
      '--x0': `${p0.x - tw / 2}px`,
      '--y0': `${p0.y - 11}px`,
      '--xm': `${m.x - tw / 2}px`,
      '--ym': `${m.y - 11}px`,
      '--x1': `${p1.x - tw / 2}px`,
      '--y1': `${p1.y - 11}px`,
    } as CSSProperties;
    flow = (
      <g key={index} pointerEvents="none">
        <path className="counting-sort-draw" pathLength={1} d={`M${p0.x} ${p0.y} Q${c.x} ${c.y} ${p1.x} ${p1.y}`} fill="none" stroke={col} strokeWidth={2.2} strokeLinecap="round" opacity={0.85} />
        <path className="counting-sort-head" d={head} fill={col} />
        <g className="counting-sort-token" style={vars}>
          <rect width={tw} height={22} rx={11} fill={col} style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))' }} />
          <text x={tw / 2} y={15.5} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="#0b0f18" style={{ fontFamily: 'var(--font-mono)' }}>
            {f.token}
          </text>
        </g>
      </g>
    );
  }

  const rowLabel = (row: Row, text: string, len: number) => (
    <text x={x0(len)} y={Y[row] - 12} fontSize={11} letterSpacing="0.1em" fill="var(--paper-faint)" style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
      {text}
    </text>
  );

  return (
    <VizStack gap={18}>
      <StatRow
        stats={[
          { label: 'tallied', value: `${s.tallies}/${n}`, tone: 'swap' },
          { label: 'prefix additions', value: s.adds, tone: 'compare' },
          { label: 'placed', value: `${s.writes}/${n}`, tone: 'done' },
          { label: 'comparisons', value: 0 },
        ]}
      />
      <svg className="av" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W * 1.4 }} role="img" aria-label="counting sort">
        <style>{CSS}</style>
        {rowLabel('in', 'input a', n)}
        {rowLabel('cnt', cntLabel, k)}
        {rowLabel('out', 'output', n)}

        {s.input.map((v, i) => (
          <g key={`in${i}`}>
            <Cell x={cx('in', i)} y={Y.in} tone={inTone(i)} label={String(v)} />
            <text className="av-idx" x={cx('in', i) + C / 2} y={Y.in + C + 14}>
              {i}
            </text>
          </g>
        ))}

        {s.counts.map((c, v) => (
          <g key={`c${v}`}>
            <Cell x={cx('cnt', v)} y={Y.cnt} tone={cntTone(v)} label={String(c)} pop={v === s.bucket ? `${index}` : undefined} />
            <text
              x={cx('cnt', v) + C / 2}
              y={Y.cnt + C + 15}
              textAnchor="middle"
              fontSize={11.5}
              fontWeight={700}
              fill={v === s.bucket ? toneFill(cntTone(v)) : 'var(--t-visited)'}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {v}
            </text>
          </g>
        ))}

        {s.out.map((o, i) => (
          <g key={`o${i}`}>
            <rect className="av-slot" x={cx('out', i)} y={Y.out} width={C} height={C} rx={8} />
            {o && <Cell x={cx('out', i)} y={Y.out} tone={outTone(i)} label={String(o.value)} corner={over ? undefined : `a${o.id}`} />}
            <text className="av-idx" x={cx('out', i) + C / 2} y={Y.out + C + 14}>
              {i}
            </text>
          </g>
        ))}
        {flow}
      </svg>
      <Callout show={s.finished} tone="found">
        sorted with 0 comparisons
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const T = '4.4s';
  const tokens = [
    { x: 18, b: 2, lvl: 0 },
    { x: 42, b: 0, lvl: 0 },
    { x: 66, b: 2, lvl: 1 },
    { x: 90, b: 1, lvl: 0 },
  ];
  const bx = [28, 52, 76];
  return (
    <svg viewBox="0 0 120 80">
      {bx.map((x, b) => (
        <g key={b}>
          <path d={`M${x - 2} 44 V72 H${x + 18} V44`} fill="none" stroke="currentColor" strokeOpacity={0.4} strokeDasharray="3 3" />
          <text x={x + 8} y={79} fontSize={6.5} textAnchor="middle" fill="currentColor" opacity={0.7}>
            {b}
          </text>
        </g>
      ))}
      {tokens.map((t, k) => {
        const t0 = 0.08 + k * 0.18;
        const t1 = t0 + 0.14;
        const ty = 62 - t.lvl * 10;
        const dx = bx[t.b] + 1 - t.x;
        const dy = ty - 8;
        const kt = `0;${t0.toFixed(2)};${t1.toFixed(2)};1`;
        return (
          <g key={k}>
            <rect x={bx[t.b]} y={ty} width={16} height={8} rx={2} fill="#ff5fa2" opacity={0}>
              <animate attributeName="opacity" values="0;0;1;1" keyTimes={kt} dur={T} repeatCount="indefinite" calcMode="discrete" />
            </rect>
            <g>
              <animateTransform attributeName="transform" type="translate" values={`0 0;0 0;${dx} ${dy};${dx} ${dy}`} keyTimes={kt} dur={T} repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;1;0;0" keyTimes={kt} dur={T} repeatCount="indefinite" calcMode="discrete" />
              <rect x={t.x} y={8} width={14} height={14} rx={3} fill="currentColor" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'counting-sort',
  name: 'Counting Sort',
  category: 'sorting',
  order: 4,
  tagline: 'Count how many of each value, then write them back in order — no comparisons.',
  description:
    'Counting sort works on small non-negative integers. It **tallies** how often each value occurs, turns the tallies into **prefix sums** (how many elements are ≤ v) and then **places** each element straight into its final slot. Walking the input right to left keeps equal values in their original order, so it is **stable** — the key property radix sort relies on.',
  howItWorks: [
    'Make a `count` array with one bucket per value `0…max`.',
    'Tally: for each element `x`, do `count[x]++`.',
    'Prefix sum: `count[v] += count[v-1]` — now `count[v]` is one past the last slot for `v`.',
    'Place from right to left: `count[x]--`, then `out[count[x]] = x`.',
  ],
  complexity: { time: 'O(n + k)', space: 'O(n + k)', note: 'k = max value + 1. Great when k is small compared to n; wasteful when values are spread widely.' },
  code: {
    js: `
function countingSort(a) { //@fn
  const k = Math.max(...a) + 1;
  const count = new Array(k).fill(0); //@alloc
  for (const x of a) count[x]++; //@count
  for (let v = 1; v < k; v++) { //@prefixLoop
    count[v] += count[v - 1]; //@prefix
  }
  const out = new Array(a.length);
  for (let i = a.length - 1; i >= 0; i--) { //@placeLoop
    const x = a[i];
    count[x]--; //@dec
    out[count[x]] = x; //@place
  }
  return out; //@done
}`,
    py: `
def counting_sort(a): #@fn
    k = max(a) + 1
    count = [0] * k #@alloc
    for x in a: count[x] += 1 #@count
    for v in range(1, k): #@prefixLoop
        count[v] += count[v - 1] #@prefix
    out = [None] * len(a)
    for i in range(len(a) - 1, -1, -1): #@placeLoop
        x = a[i]
        count[x] -= 1 #@dec
        out[count[x]] = x #@place
    return out #@done`,
  },
  input: listInput({ def: [6, 2, 9, 2, 0, 5, 9, 3, 2, 7], min: 0, max: 20, maxLen: 16, randLen: [6, 12] }),
  run,
  View,
  legend: [
    { tone: 'active', label: 'reading' },
    { tone: 'swap', label: 'count / slot being written' },
    { tone: 'compare', label: 'added into next bucket' },
    { tone: 'done', label: 'placed in output' },
    { tone: 'muted', label: 'already placed' },
  ],
  Glyph,
});
