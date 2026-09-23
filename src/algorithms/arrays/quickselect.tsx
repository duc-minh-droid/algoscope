import { useId } from 'react';
import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt, randomArray, withIds, type Item } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizStack, toneFill, type Pointer } from '@/viz';
import { arrowHead, avGeom, sketchArc, sketchLine } from './_arraysB';

interface Input {
  arr: number[];
  k: number; // 1-based
}

type Stage = 'setup' | 'partition' | 'place' | 'decide' | 'done';

interface Verdict {
  at: number; // where the pivot landed
  dir: 'left' | 'right' | 'hit';
}

interface State {
  items: Item[];
  lo: number;
  hi: number;
  i: number; // boundary of the "< pivot" zone (-1 = hidden)
  j: number; // scanner (-1 = hidden)
  pivotAt: number; // index holding the pivot (-1 = none)
  t: number; // target index k-1
  fixed: number[]; // indices where a pivot has landed (final sorted spot)
  swapPair: number[];
  verdict: Verdict | null;
  stage: Stage;
  cmp: number;
  swaps: number;
  sortCmp: number; // comparisons a full quicksort (same pivots) would need
  result: number | null;
}

const CELL = 50;

/** Comparisons a full Lomuto quicksort would make on the same input — for the "vs full sort" stat. */
function quicksortCompares(src: number[]) {
  const a = [...src];
  let c = 0;
  const stack: [number, number][] = [[0, a.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (lo >= hi) continue;
    const p = a[hi];
    let i = lo;
    for (let j = lo; j < hi; j++) {
      c++;
      if (a[j] < p) {
        [a[i], a[j]] = [a[j], a[i]];
        i++;
      }
    }
    [a[i], a[hi]] = [a[hi], a[i]];
    stack.push([lo, i - 1], [i + 1, hi]);
  }
  return c;
}

const ord = (k: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = k % 100;
  return k + (s[(v - 20) % 10] || s[v] || s[0]);
};

function* run({ arr, k }: Input): Generator<Frame<State>> {
  const items = withIds(arr);
  const t = k - 1;
  const n = arr.length;
  const sortCmp = quicksortCompares(arr);
  let lo = 0;
  let hi = n - 1;
  let cmp = 0;
  let swaps = 0;
  const fixed: number[] = [];
  const snap = (o: Partial<State>): State => ({
    items: items.map((x) => ({ ...x })),
    lo,
    hi,
    i: -1,
    j: -1,
    pivotAt: -1,
    t,
    fixed: [...fixed],
    swapPair: [],
    verdict: null,
    stage: 'partition',
    cmp,
    swaps,
    sortCmp,
    result: null,
    ...o,
  });
  const vars = (pivot: number | undefined, i: number | undefined, j: number | undefined) => ({
    k,
    'k-1': t,
    lo,
    hi,
    pivot,
    i,
    j,
    'arr[j]': j === undefined ? undefined : items[j].value,
  });

  yield {
    state: snap({ stage: 'setup' }),
    line: ['fn', 'target'],
    note: `We want the **${ord(k)} smallest** value, i.e. whatever would sit at index **${t}** if the array were sorted. Instead of sorting everything, we partition around a pivot and keep **only the side that can contain index ${t}**.`,
    vars: vars(undefined, undefined, undefined),
    phase: 'setup',
  };

  while (true) {
    if (lo === hi) {
      const v = items[lo].value;
      fixed.push(lo);
      yield {
        state: snap({ stage: 'done', result: v }),
        line: 'single',
        note: `The window has shrunk to a single cell, index **${lo}** — it must be the answer. The ${ord(k)} smallest is **${v}**.`,
        vars: vars(undefined, undefined, undefined),
        phase: 'done',
      };
      return;
    }
    const pivot = items[hi].value;
    let i = lo;
    yield {
      state: snap({ i, pivotAt: hi }),
      line: ['loop', 'pivot'],
      note: `Window is **[${lo}..${hi}]** (${hi - lo + 1} values). Take the last one, **${pivot}**, as the pivot. We'll sweep \`j\` across and push everything smaller than ${pivot} to the front, behind the boundary \`i\`.`,
      vars: vars(pivot, i, undefined),
      phase: 'partition',
    };
    for (let j = lo; j < hi; j++) {
      cmp++;
      const v = items[j].value;
      if (v < pivot) {
        if (i === j) {
          i++;
          yield {
            state: snap({ i, j, pivotAt: hi }),
            line: ['scan', 'cmp', 'swap'],
            note: `\`${v} < ${pivot}\` — it belongs on the small side, and it's already right at the boundary, so no swap is needed: \`i\` just steps to **${i}**.`,
            vars: vars(pivot, i, j),
            phase: 'partition',
          };
        } else {
          yield {
            state: snap({ i, j, pivotAt: hi }),
            line: ['scan', 'cmp'],
            note: `\`${v} < ${pivot}\` — yes! It belongs on the small side, but it's sitting past the boundary \`i = ${i}\`.`,
            vars: vars(pivot, i, j),
            phase: 'partition',
          };
          [items[i], items[j]] = [items[j], items[i]];
          swaps++;
          const oi = i;
          i++;
          yield {
            state: snap({ i, j, pivotAt: hi, swapPair: [oi, j] }),
            line: 'swap',
            note: `Swap **${v}** into index **${oi}** (trading places with ${items[j].value}). The small zone now covers [${lo}..${oi}], so \`i\` moves to **${i}**.`,
            vars: vars(pivot, i, j),
            phase: 'partition',
          };
        }
      } else {
        yield {
          state: snap({ i, j, pivotAt: hi }),
          line: ['scan', 'cmp'],
          note: `\`${v} ≥ ${pivot}\` — it stays on the big side. \`i\` doesn't move.`,
          vars: vars(pivot, i, j),
          phase: 'partition',
        };
      }
    }
    // place the pivot
    [items[i], items[hi]] = [items[hi], items[i]];
    if (i !== hi) swaps++;
    fixed.push(i);
    yield {
      state: snap({ i, pivotAt: i, stage: 'place', swapPair: i !== hi ? [i, hi] : [] }),
      line: 'place',
      note: `Drop the pivot **${pivot}** into the boundary slot **${i}**. Everything left of it is smaller, everything right is ≥ — so ${pivot} is now in its **final sorted position**: it is the ${ord(i + 1)} smallest.`,
      vars: vars(pivot, i, undefined),
      phase: 'partition',
    };
    if (i === t) {
      yield {
        state: snap({ i, pivotAt: i, stage: 'done', verdict: { at: i, dir: 'hit' }, result: pivot }),
        line: 'hit',
        note: `The pivot landed exactly on index **${t}** = k−1. Done: the ${ord(k)} smallest is **${pivot}**, after only **${cmp}** comparisons (a full quicksort would take ${sortCmp}).`,
        vars: vars(pivot, i, undefined),
        phase: 'done',
      };
      return;
    }
    if (t < i) {
      const dropped = hi - i;
      hi = i - 1;
      yield {
        state: snap({ i: -1, pivotAt: i, stage: 'decide', verdict: { at: i, dir: 'left' } }),
        line: 'left',
        note: `Target index **${t}** < pivot index ${i}, so k is on the **left**. The ${dropped} value${dropped === 1 ? '' : 's'} right of the pivot are all bigger than the answer — we **never look at them again**. New window [${lo}..${hi}].`,
        vars: vars(pivot, i, undefined),
        phase: 'narrow',
      };
    } else {
      const dropped = i - lo;
      lo = i + 1;
      yield {
        state: snap({ i: -1, pivotAt: i, stage: 'decide', verdict: { at: i, dir: 'right' } }),
        line: 'right',
        note: `Target index **${t}** > pivot index ${i}, so k is on the **right**. The ${dropped} value${dropped === 1 ? '' : 's'} left of the pivot are all smaller than the answer — we **never look at them again**. New window [${lo}..${hi}].`,
        vars: vars(pivot, i, undefined),
        phase: 'narrow',
      };
    }
  }
}

function Lane({ n, s }: { n: number; s: State }) {
  const uid = useId().replace(/:/g, '');
  const g = avGeom(n, CELL);
  const H = 62;
  const zones: [number, number][] = [];
  if (s.stage !== 'setup') {
    if (s.lo > 0) zones.push([0, s.lo - 1]);
    if (s.hi < n - 1) zones.push([s.hi + 1, n - 1]);
  }
  const v = s.verdict;
  let arrow: { d: string; head: string; label: string; lx: number } | null = null;
  if (v && v.dir !== 'hit') {
    const x1 = g.cx(v.at);
    const x2 = (g.cx(s.lo) + g.cx(s.hi)) / 2;
    const d = sketchArc(x1, x2, 8, 40, v.at * 7 + s.lo);
    const a = Math.atan2(-40, x2 - (x1 + x2) / 2);
    arrow = { d, head: arrowHead(x2, 8, a, 9), label: `k is on the ${v.dir}`, lx: (x1 + x2) / 2 };
  }
  return (
    <svg viewBox={`0 0 ${g.W} ${H}`} style={g.style} aria-hidden>
      <style>{`
        .quickselect-draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: quickselect-draw calc(var(--step-ms) * 1.4) var(--ease-out) forwards; }
        .quickselect-fade { animation: quickselect-fade calc(var(--step-ms) * 1.2) var(--ease-out); }
        @keyframes quickselect-draw { to { stroke-dashoffset: 0; } }
        @keyframes quickselect-fade { from { opacity: 0; transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) { .quickselect-draw { animation-duration: 1ms; } .quickselect-fade { animation: none; } }
      `}</style>
      <defs>
        <pattern id={`qs-hatch-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#6f6f72" strokeWidth="1.4" strokeOpacity="0.55" />
        </pattern>
      </defs>
      {zones.map(([a, b]) => {
        const x0 = g.xOf(a) - 3;
        const x1 = g.xOf(b) + CELL + 3;
        return (
          <g key={`${a}-${b}`} className="quickselect-fade">
            <rect x={x0} y={4} width={x1 - x0} height={26} rx={7} fill={`url(#qs-hatch-${uid})`} stroke="#6f6f72" strokeOpacity={0.5} strokeDasharray="4 4" />
            <path d={sketchLine(x0 + 4, 17, x1 - 4, 17, a + b, 1.2)} stroke="#ff6b5b" strokeOpacity={0.55} strokeWidth={1.6} fill="none" />
            {x1 - x0 > 90 && (
              <text x={(x0 + x1) / 2} y={46} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10.5} fill="var(--paper-faint)">
                discarded · never visited again
              </text>
            )}
          </g>
        );
      })}
      {arrow && (
        <g key={`arrow-${v!.at}-${s.lo}-${s.hi}`}>
          <path className="quickselect-draw" pathLength={1} d={arrow.d} fill="none" stroke={toneFill('path')} strokeWidth={2.4} strokeLinecap="round" />
          <path className="quickselect-fade" d={arrow.head} fill="none" stroke={toneFill('path')} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          <text className="quickselect-fade" x={arrow.lx} y={H - 2} textAnchor="middle" fontFamily="var(--font-display)" fontStyle="italic" fontSize={17} fill={toneFill('path')}>
            {arrow.label}
          </text>
        </g>
      )}
      {v && v.dir === 'hit' && (
        <g key="hit">
          <circle className="quickselect-draw" pathLength={1} cx={g.cx(v.at)} cy={20} r={15} fill="none" stroke={toneFill('found')} strokeWidth={2.4} />
          <text className="quickselect-fade" x={g.cx(v.at)} y={H - 4} textAnchor="middle" fontFamily="var(--font-display)" fontStyle="italic" fontSize={17} fill={toneFill('found')}>
            pivot landed on k−1
          </text>
        </g>
      )}
    </svg>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const { items, lo, hi, i, j, pivotAt, t, fixed, swapPair, stage, result } = s;
  const n = items.length;
  const inPartition = stage === 'partition';
  const tone = (p: number): Tone | undefined => {
    if (result !== null && p === t) return 'found';
    if (swapPair.includes(p)) return 'swap';
    if (fixed.includes(p)) return 'done';
    if (stage !== 'setup' && (p < lo || p > hi)) return 'muted';
    if (inPartition) {
      if (p === pivotAt) return 'frontier';
      if (p === j) return 'compare';
      if (p >= lo && p < i) return 'visited';
    }
    return undefined;
  };
  const pointers: Pointer[] = [
    { index: inPartition ? i : -1, label: 'i', tone: 'visited' },
    { index: inPartition ? j : -1, label: 'j', tone: 'compare' },
    { index: stage === 'setup' || stage === 'done' ? -1 : pivotAt, label: 'pivot', tone: 'frontier' },
    { index: t, label: `k-1 = ${t}`, tone: result !== null ? 'found' : 'path', side: 'bottom' },
  ];
  const size = stage === 'done' ? 1 : hi - lo + 1;
  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'quickselect compares', value: s.cmp, tone: 'active' },
          { label: 'full quicksort would use', value: s.sortCmp },
          { label: 'swaps', value: s.swaps },
          { label: 'window size', value: `${size} / ${n}` },
        ]}
      />
      <div>
        <ArrayView
          items={items}
          tones={tone}
          pointers={pointers}
          spans={[{ from: stage === 'done' ? t : lo, to: stage === 'done' ? t : hi, label: stage === 'done' ? 'answer' : `window [${lo}..${hi}]`, tone: 'frontier' }]}
          cell={CELL}
        />
        <Lane n={n} s={s} />
      </div>
      <Callout show={result !== null} tone="found">
        {`${ord(t + 1)} smallest = ${result ?? '…'}`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const xs = [8, 30, 52, 74, 96];
  return (
    <svg viewBox="0 0 120 80">
      {xs.map((x, k) => (
        <rect key={k} x={x} y={24} width={18} height={18} rx={4} fill="var(--ink-3)" stroke="currentColor" strokeOpacity={0.45}>
          {k >= 3 && <animate attributeName="opacity" values="1;1;0.25;0.25;1" keyTimes="0;0.35;0.5;0.9;1" dur="4s" repeatCount="indefinite" />}
          {k === 0 && <animate attributeName="opacity" values="1;1;1;0.25;0.25;1" keyTimes="0;0.5;0.6;0.7;0.9;1" dur="4s" repeatCount="indefinite" />}
        </rect>
      ))}
      <rect x={96} y={24} width={18} height={18} rx={4} fill="#a98bff">
        <animate attributeName="x" values="96;96;52;52;52" keyTimes="0;0.2;0.35;0.9;1" dur="4s" repeatCount="indefinite" />
        <animate attributeName="fill" values="#a98bff;#a98bff;#5fd3a5;#5fd3a5;#a98bff" keyTimes="0;0.2;0.35;0.9;1" dur="4s" repeatCount="indefinite" />
      </rect>
      <path d="M61 50 Q46 70 32 52" fill="none" stroke="#ffd166" strokeWidth={2} strokeLinecap="round" strokeDasharray="40" strokeDashoffset="40">
        <animate attributeName="stroke-dashoffset" values="40;40;0;0;40" keyTimes="0;0.5;0.62;0.9;1" dur="4s" repeatCount="indefinite" />
      </path>
      <path d="M39 18 l-4 -7 h8 z" fill="currentColor" />
      <line x1={80} y1={33} x2={114} y2={33} stroke="#ff6b5b" strokeWidth={1.6} opacity={0}>
        <animate attributeName="opacity" values="0;0;0.8;0.8;0" keyTimes="0;0.38;0.5;0.9;1" dur="4s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'quickselect',
  name: 'Quickselect',
  category: 'arrays',
  order: 4,
  tagline: 'Find the k-th smallest without sorting — partition, then keep only the half that matters.',
  description:
    'Quickselect borrows quicksort\'s **partition** step: after one pass the pivot sits in its final sorted position. If that position is `k−1` we are done; otherwise the answer lies on **one** side only, so the other side is thrown away. Throwing half away each round is why it averages **O(n)** instead of sorting\'s O(n log n).',
  howItWorks: [
    'Pick the last element of the window as the **pivot**.',
    'Sweep `j` through the window, swapping every value smaller than the pivot behind the boundary `i`.',
    'Swap the pivot into slot `i` — it is now exactly where sorting would put it.',
    'If `i = k−1`, return it. Otherwise shrink the window to the side containing `k−1` and repeat.',
  ],
  complexity: { time: 'O(n) average', space: 'O(1)', note: 'Worst case O(n²) — e.g. already-sorted input with a last-element pivot. Random pivots make that vanishingly unlikely.' },
  code: {
    js: `
function quickselect(arr, k) { //@fn
  const t = k - 1; //@target
  let lo = 0, hi = arr.length - 1;
  while (true) { //@loop
    if (lo === hi) return arr[lo]; //@single
    const pivot = arr[hi]; //@pivot
    let i = lo;
    for (let j = lo; j < hi; j++) { //@scan
      if (arr[j] < pivot) { //@cmp
        [arr[i], arr[j]] = [arr[j], arr[i]]; //@swap
        i++;
      }
    }
    [arr[i], arr[hi]] = [arr[hi], arr[i]]; //@place
    if (i === t) return arr[i]; //@hit
    if (t < i) hi = i - 1; //@left
    else lo = i + 1; //@right
  }
}`,
    py: `
def quickselect(arr, k): #@fn
    t = k - 1 #@target
    lo, hi = 0, len(arr) - 1
    while True: #@loop
        if lo == hi: return arr[lo] #@single
        pivot = arr[hi] #@pivot
        i = lo
        for j in range(lo, hi): #@scan
            if arr[j] < pivot: #@cmp
                arr[i], arr[j] = arr[j], arr[i] #@swap
                i += 1
        arr[i], arr[hi] = arr[hi], arr[i] #@place
        if i == t: return arr[i] #@hit
        if t < i: hi = i - 1 #@left
        else: lo = i + 1 #@right`,
  },
  input: {
    default: { arr: [12, 4, 9, 15, 1, 7, 18, 3, 11, 6], k: 7 },
    presets: [
      { name: 'Largest (k = n)', value: { arr: [23, 8, 42, 15, 4, 16], k: 6 } },
      { name: 'Sorted = worst case', value: { arr: [1, 2, 3, 4, 5, 6, 7, 8], k: 2 } },
      { name: 'Duplicates', value: { arr: [5, 3, 5, 1, 5, 3, 2, 5], k: 5 } },
      { name: 'Single value', value: { arr: [42], k: 1 } },
    ],
    random: () => {
      const arr = randomArray(randInt(6, 12), 1, 60);
      return { arr, k: randInt(1, arr.length) };
    },
    format: (v) => `${formatNumberList(v.arr)} | ${v.k}`,
    parse: (text) => {
      const [a, kk, extra] = text.split('|');
      if (kk === undefined) throw new Error('Add k after a "|", e.g. "7, 2, 9, 4 | 2" finds the 2nd smallest.');
      if (extra !== undefined) throw new Error('Use a single "|" between the numbers and k.');
      const arr = parseNumberList(a, { minLen: 1, maxLen: 16, min: -99, max: 999 });
      const ks = parseNumberList(kk, { minLen: 1, maxLen: 1, min: -9999, max: 9999 });
      const k = ks[0];
      if (k < 1 || k > arr.length) throw new Error(`k must be between 1 and ${arr.length} (there ${arr.length === 1 ? 'is 1 number' : `are ${arr.length} numbers`}).`);
      return { arr, k };
    },
    placeholder: '12, 4, 9, 15, 1, 7 | 3',
    hint: 'Up to 16 whole numbers, then "|" and k (1 = smallest, n = largest).',
  },
  run,
  View,
  legend: [
    { tone: 'frontier', label: 'pivot' },
    { tone: 'compare', label: 'j: comparing' },
    { tone: 'visited', label: '< pivot zone' },
    { tone: 'swap', label: 'swapping' },
    { tone: 'done', label: 'pivot in final spot' },
    { tone: 'muted', label: 'discarded half' },
    { tone: 'found', label: 'k-th smallest' },
  ],
  Glyph,
});
