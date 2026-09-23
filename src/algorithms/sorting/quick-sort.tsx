import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, randInt, randomArray, withIds, type Item } from '@/core/utils';
import { ArrayView, Callout, StatRow, TokenStrip, VizSection, VizStack, toneFill } from '@/viz';
import { SortBStyle, listText, parseSortList } from './_sortB';

type Input = number[];
type Mode = 'idle' | 'call' | 'pivot' | 'cmp' | 'swap' | 'place' | 'base' | 'end';

interface State {
  items: Item<number>[];
  done: boolean[];
  lo: number;
  hi: number;
  pivotIdx: number;
  pivot: number | null;
  i: number;
  j: number;
  mode: Mode;
  swapA: number;
  swapB: number;
  stack: { lo: number; hi: number }[];
  cmps: number;
  swaps: number;
  maxDepth: number;
  finished: boolean;
}

function* run(arr: Input): Generator<Frame<State>> {
  const n = arr.length;
  const items = withIds(arr);
  const done = Array<boolean>(n).fill(false);
  const stack: { lo: number; hi: number }[] = [];
  let cmps = 0;
  let swaps = 0;
  let maxDepth = 0;
  const st = { lo: -1, hi: -1, pivotIdx: -1, pivot: null as number | null, i: -1, j: -1, mode: 'idle' as Mode, swapA: -1, swapB: -1 };
  const S = (finished = false): State => ({
    items: items.map((x) => ({ ...x })),
    done: [...done],
    stack: stack.map((x) => ({ ...x })),
    ...st,
    cmps,
    swaps,
    maxDepth,
    finished,
  });
  const V = () => ({
    lo: st.lo < 0 ? undefined : st.lo,
    hi: st.hi < 0 ? undefined : st.hi,
    pivot: st.pivot ?? undefined,
    i: st.i < 0 ? undefined : st.i,
    j: st.j < 0 ? undefined : st.j,
    'a[j]': st.j >= 0 && st.mode === 'cmp' ? items[st.j].value : undefined,
  });
  const swap = (a: number, b: number) => {
    [items[a], items[b]] = [items[b], items[a]];
  };
  const lines = (via: string | null, ...rest: string[]) => (via ? [via, ...rest] : rest);

  yield {
    state: S(),
    line: 'fn',
    note: `Quick sort picks a **pivot**, moves everything smaller to its left and everything else to its right (**partition**), then sorts both sides recursively. We use **Lomuto's scheme**: the pivot is always the **last** element of the range.`,
    vars: V(),
    phase: 'partition',
  };

  function* qs(lo: number, hi: number, via: string | null): Generator<Frame<State>> {
    if (lo > hi) return;
    stack.push({ lo, hi });
    maxDepth = Math.max(maxDepth, stack.length);
    Object.assign(st, { lo, hi, pivotIdx: -1, pivot: null, i: -1, j: -1, swapA: -1, swapB: -1 });
    if (lo === hi) {
      done[lo] = true;
      st.mode = 'base';
      yield {
        state: S(),
        line: lines(via, 'fn', 'base'),
        note: `Range [${lo}..${hi}] holds only **${items[lo].value}**. A single element is already in its **final** place — nothing to partition.`,
        vars: V(),
        phase: 'partition',
      };
      stack.pop();
      return;
    }
    st.mode = 'call';
    yield {
      state: S(),
      line: lines(via, 'fn'),
      note: `Sort range [${lo}..${hi}] = **${listText(items.slice(lo, hi + 1).map((x) => x.value))}** (${hi - lo + 1} elements). First, partition it.`,
      vars: V(),
      phase: 'partition',
    };
    const pivot = items[hi].value;
    let i = lo;
    Object.assign(st, { mode: 'pivot', pivotIdx: hi, pivot, i, j: lo });
    yield {
      state: S(),
      line: ['part', 'pivot', 'init'],
      note: `Lomuto uses the **last** element as the pivot: **${pivot}**. \`i = ${lo}\` marks where the next element smaller than ${pivot} will go — the "< ${pivot}" region starts empty.`,
      vars: V(),
      phase: 'partition',
    };
    for (let j = lo; j < hi; j++) {
      const v = items[j].value;
      Object.assign(st, { mode: 'cmp', j, swapA: -1, swapB: -1 });
      cmps++;
      const less = v < pivot;
      yield {
        state: S(),
        line: ['loop', 'cmp'],
        note: less
          ? `a[${j}] = **${v}** < ${pivot}, so it belongs in the left "< pivot" region.`
          : `a[${j}] = **${v}** ≥ ${pivot}: leave it where it is — the "≥ pivot" region just grows by one.`,
        vars: V(),
        phase: 'partition',
      };
      if (less) {
        const noop = i === j;
        if (!noop) {
          swap(i, j);
          swaps++;
        }
        Object.assign(st, { mode: 'swap', swapA: i, swapB: j, i: i + 1 });
        yield {
          state: S(),
          line: ['swap', 'inc'],
          note: noop
            ? `i = j = ${i}, so the swap is a no-op — **${v}** already sits at the edge of the "< ${pivot}" region. Just grow the region: i → **${i + 1}**.`
            : `Swap a[${i}] and a[${j}]: **${v}** jumps into the "< ${pivot}" region and the ≥ value **${items[j].value}** moves back. Then i → **${i + 1}**.`,
          vars: V(),
          phase: 'partition',
        };
        i++;
      }
    }
    // place the pivot
    const moved = i !== hi;
    if (moved) {
      swap(i, hi);
      swaps++;
    }
    done[i] = true;
    Object.assign(st, { mode: 'place', pivotIdx: i, j: -1, swapA: moved ? hi : -1, swapB: i });
    const leftN = i - lo;
    const rightN = hi - i;
    yield {
      state: S(),
      line: ['place', 'ret'],
      note: `Scan finished. Swap the pivot into a[${i}]: all ${leftN} value${leftN === 1 ? '' : 's'} to its left are smaller and all ${rightN} to its right are ≥, so **${pivot}** is in its **final** position.${leftN === 0 || rightN === 0 ? ` One side is empty — an unlucky, lopsided split.` : ''}`,
      vars: V(),
      phase: 'partition',
    };
    const p = i;
    yield* qs(lo, p - 1, 'left');
    yield* qs(p + 1, hi, 'right');
    stack.pop();
  }

  yield* qs(0, n - 1, null);
  done.fill(true);
  Object.assign(st, { lo: -1, hi: -1, pivotIdx: -1, pivot: null, i: -1, j: -1, mode: 'end', swapA: -1, swapB: -1 });
  const worst = n > 3 && maxDepth >= n - 1;
  yield {
    state: S(true),
    line: 'fn',
    note: worst
      ? `Sorted with **${cmps}** comparisons. The recursion went **${maxDepth}** calls deep: every pivot was an extreme value, so each partition peeled off just one element — the **O(n²) worst case** (it happens on already-sorted input with a last-element pivot).`
      : `Sorted with **${cmps}** comparisons and **${swaps}** swaps; the recursion was at most **${maxDepth}** calls deep. Balanced splits give ~log₂n levels → **O(n log n)**.`,
    vars: V(),
    phase: 'done',
  };
}

// ---------------------------------------------------------------- View

const CELL = 46;
const GAP = 8;

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const n = s.items.length;
  const partitioning = s.mode === 'cmp' || s.mode === 'swap' || s.mode === 'pivot';
  const tone = (k: number): Tone | undefined => {
    if ((s.mode === 'swap' || s.mode === 'place') && (k === s.swapA || k === s.swapB) && !(s.mode === 'place' && k === s.pivotIdx)) return 'swap';
    if (s.done[k]) return 'done';
    if (s.lo >= 0 && (k < s.lo || k > s.hi)) return 'muted';
    if (k === s.pivotIdx) return 'frontier';
    if (s.mode === 'cmp' && k === s.j) return 'compare';
    if (partitioning && k >= s.lo && k < s.i) return 'visited';
    if (partitioning && k >= s.i && k < s.j) return 'path';
    if (s.mode === 'swap' && k >= s.i && k <= s.j) return 'path';
    if (s.mode === 'place' && k >= s.lo && k <= s.hi) return k < s.pivotIdx ? 'visited' : 'path';
    return undefined;
  };
  const maxValue = Math.max(1, ...s.items.map((x) => Math.abs(x.value)));
  const pointers = [
    { index: s.pivotIdx, label: 'pivot', tone: (s.mode === 'place' ? 'done' : 'frontier') as Tone, side: 'top' as const },
    { index: partitioning || s.mode === 'place' ? s.i : -1, label: 'i', tone: 'visited' as Tone, side: 'bottom' as const },
    { index: s.mode === 'cmp' || s.mode === 'swap' ? s.j : -1, label: 'j', tone: 'compare' as Tone, side: 'bottom' as const },
  ];

  // Region ribbon, geometry mirrors ArrayView (pad 14, stride CELL+GAP).
  const W = 28 + n * (CELL + GAP) - GAP;
  const xOf = (k: number) => 14 + k * (CELL + GAP);
  const jEnd = s.mode === 'swap' ? s.swapB + 1 : s.j;
  const regions =
    partitioning && s.lo >= 0
      ? [
          { key: 'lt', from: s.lo, to: s.i, tone: 'visited' as Tone, label: `< ${s.pivot}` },
          { key: 'ge', from: s.i, to: jEnd, tone: 'path' as Tone, label: `≥ ${s.pivot}` },
          { key: 'un', from: jEnd, to: s.hi, tone: 'idle' as Tone, label: 'unscanned' },
        ]
      : [];

  return (
    <VizStack gap={12}>
      <StatRow
        stats={[
          { label: 'comparisons', value: s.cmps, tone: 'compare' },
          { label: 'swaps', value: s.swaps, tone: 'swap' },
          { label: 'pivot', value: s.pivot ?? '—', tone: 'frontier' },
          { label: 'recursion depth', value: `${s.stack.length} (max ${s.maxDepth})` },
        ]}
      />
      <div>
        <ArrayView
          items={s.items}
          variant="bars"
          barHeight={150}
          cell={CELL}
          gap={GAP}
          maxValue={maxValue}
          tones={tone}
          pointers={pointers}
          spans={s.lo >= 0 && s.hi > s.lo ? [{ from: s.lo, to: s.hi, label: `range [${s.lo}..${s.hi}]`, tone: 'active', side: 'top' }] : []}
        />
        <svg viewBox={`0 0 ${W} 34`} style={{ display: 'block', width: '100%', maxWidth: W * 1.5, margin: '0 auto', overflow: 'visible' }} aria-hidden>
          <SortBStyle />
          {['lt', 'ge', 'un'].map((k) => {
            const r = regions.find((x) => x.key === k);
            const x0 = r ? xOf(r.from) : 0;
            const w = r ? Math.max(0, (r.to - r.from) * (CELL + GAP) - GAP) : 0;
            const show = !!r && r.to > r.from;
            return (
              <g key={k}>
                <rect
                  className="sortb-geo"
                  x={x0}
                  y={4}
                  width={w}
                  height={22}
                  rx={6}
                  strokeWidth={1.5}
                  strokeDasharray={k === 'un' ? '4 4' : undefined}
                  style={{
                    fill: r && r.tone !== 'idle' ? toneFill(r.tone) : 'transparent',
                    fillOpacity: 0.22,
                    stroke: r && r.tone !== 'idle' ? toneFill(r.tone) : 'var(--line-strong)',
                    opacity: show ? 1 : 0,
                  }}
                />
                <text
                  className="sortb-val sortb-fade"
                  x={x0 + w / 2}
                  y={19.5}
                  fontSize={11.5}
                  style={{ fill: r && r.tone !== 'idle' ? toneFill(r.tone) : 'var(--paper-faint)', opacity: show && w >= 40 ? 1 : 0 }}
                >
                  {r?.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <VizSection label="call stack" aside="top of stack is the range being sorted now">
        <TokenStrip
          items={s.stack.map((r, k) => ({ id: `${r.lo}-${r.hi}`, text: `[${r.lo}..${r.hi}]`, tone: k === s.stack.length - 1 ? 'active' : 'frontier' }))}
          empty={s.finished ? 'all calls returned' : 'empty'}
        />
      </VizSection>
      <Callout show={s.finished} tone="done">
        sorted: {s.items.map((x) => x.value).join(' · ')}
      </Callout>
    </VizStack>
  );
}

// ---------------------------------------------------------------- Glyph

function Glyph() {
  const hs = [20, 40, 14, 34, 10, 26];
  const target = [0, 4, 1, 5, 2, 3];
  const color = ['#6cb6ff', '#ffd166', '#6cb6ff', '#ffd166', '#6cb6ff', '#5fd3a5'];
  const kt = '0;0.6;0.78;1';
  return (
    <svg viewBox="0 0 120 80">
      {hs.map((h, k) => (
        <rect key={k} x={14 + k * 16} y={62 - h} width={12} height={h} rx={2.5} fill={k === 5 ? '#a98bff' : 'currentColor'} opacity={0.95}>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 0;0 0;${(target[k] - k) * 16} 0;${(target[k] - k) * 16} 0`}
            keyTimes={kt}
            dur="4s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0 0 1 1;0.4 0 0.2 1;0 0 1 1"
          />
          <animate
            attributeName="fill"
            values={`${k === 5 ? '#a98bff' : 'currentColor'};${k === 5 ? '#a98bff' : color[k]};${color[k]};${color[k]}`}
            keyTimes={kt}
            dur="4s"
            repeatCount="indefinite"
            calcMode="discrete"
          />
        </rect>
      ))}
      <path d="M20 66 l-4 6 h8 z" fill="#ff6b5b">
        <animateTransform attributeName="transform" type="translate" values="0 0;80 0;80 0;0 0" keyTimes={kt} dur="4s" repeatCount="indefinite" />
      </path>
      <text x={100} y={14} fontSize={9} fill="#a98bff" textAnchor="middle" fontFamily="monospace">
        pivot
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------- definition

export default defineAlgorithm<Input, State>({
  id: 'quick-sort',
  name: 'Quick Sort',
  category: 'sorting',
  order: 6,
  tagline: 'Partition around a pivot, then sort each side.',
  description:
    'Pick a **pivot**, then rearrange the range so smaller values come first and the rest after — the pivot lands in its **final** position. Recursively sort the two sides. With **Lomuto partitioning** the pivot is the **last** element; good pivots split evenly (O(n log n)), but on already-sorted input every split is lopsided (O(n²)).',
  howItWorks: [
    'Choose the last element of the range as the `pivot`.',
    'Scan with `j`; whenever `a[j] < pivot`, swap it to position `i` and grow the "< pivot" region.',
    'After the scan, swap the pivot into `a[i]` — it is now final.',
    'Recurse on the left part `[lo, i-1]` and the right part `[i+1, hi]`.',
  ],
  complexity: { time: 'O(n log n) avg, O(n²) worst', space: 'O(log n) avg stack', note: 'In place. Not stable. Worst case when pivots are always the min or max (e.g. sorted input with a last-element pivot).' },
  code: {
    js: `
function quickSort(a, lo = 0, hi = a.length - 1) { //@fn
  if (lo >= hi) return; //@base
  const p = partition(a, lo, hi); //@part
  quickSort(a, lo, p - 1); //@left
  quickSort(a, p + 1, hi); //@right
}

function partition(a, lo, hi) {
  const pivot = a[hi]; //@pivot
  let i = lo; //@init
  for (let j = lo; j < hi; j++) { //@loop
    if (a[j] < pivot) { //@cmp
      [a[i], a[j]] = [a[j], a[i]]; //@swap
      i++; //@inc
    }
  }
  [a[i], a[hi]] = [a[hi], a[i]]; //@place
  return i; //@ret
}`,
    py: `
def quick_sort(a, lo=0, hi=None): #@fn
    if hi is None: hi = len(a) - 1
    if lo >= hi: return #@base
    p = partition(a, lo, hi) #@part
    quick_sort(a, lo, p - 1) #@left
    quick_sort(a, p + 1, hi) #@right

def partition(a, lo, hi):
    pivot = a[hi] #@pivot
    i = lo #@init
    for j in range(lo, hi): #@loop
        if a[j] < pivot: #@cmp
            a[i], a[j] = a[j], a[i] #@swap
            i += 1 #@inc
    a[i], a[hi] = a[hi], a[i] #@place
    return i #@ret`,
  },
  input: {
    default: [38, 81, 22, 47, 5, 63, 15, 74, 29, 50],
    presets: [
      { name: 'Random mix', value: [38, 81, 22, 47, 5, 63, 15, 74, 29, 50] },
      { name: 'Already sorted (worst case)', value: [5, 12, 19, 26, 33, 40, 47, 54] },
      { name: 'Reversed', value: [60, 52, 44, 36, 28, 20, 12, 4] },
      { name: 'Duplicates', value: [4, 7, 4, 1, 7, 4, 2, 7] },
      { name: 'Single element', value: [42] },
    ],
    random: () => randomArray(randInt(6, 10), 1, 99),
    format: formatNumberList,
    parse: (text) => parseSortList(text, { min: -99, max: 999, maxLen: 16 }),
    placeholder: '38, 81, 22, 47, 5, 63',
    hint: 'Whole numbers from -99 to 999, separated by commas. 1–16 values.',
  },
  run,
  View,
  legend: [
    { tone: 'frontier', label: 'pivot' },
    { tone: 'compare', label: 'j (scanning)' },
    { tone: 'visited', label: '< pivot' },
    { tone: 'path', label: '≥ pivot' },
    { tone: 'swap', label: 'swapping' },
    { tone: 'done', label: 'final place' },
    { tone: 'muted', label: 'outside range' },
  ],
  Glyph,
});
