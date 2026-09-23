import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { withIds, type Item } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizStack, type Pointer } from '@/viz';
import { finalTone, listInput, plural, sweepFronts } from './_sortA';

type Input = number[];

interface State {
  items: Item[];
  i: number; // start of the unsorted part (-1 none)
  j: number; // scanning pointer (-1 none)
  min: number; // index of the current minimum (-1 none)
  cmp: boolean; // j is being compared right now
  swapA: number; // indices gliding past each other (-1 none)
  swapB: number;
  sorted: number; // indices < sorted are final
  comps: number;
  swaps: number;
  sweep: number;
  finished: boolean;
}

function* run(input: Input): Generator<Frame<State>> {
  const a = withIds(input);
  const n = a.length;
  let comps = 0;
  let swaps = 0;
  const S = (p: Partial<State>): State => ({
    items: a.map((x) => ({ ...x })),
    i: -1,
    j: -1,
    min: -1,
    cmp: false,
    swapA: -1,
    swapB: -1,
    sorted: 0,
    comps,
    swaps,
    sweep: -1,
    finished: false,
    ...p,
  });
  const V = (i?: number, j?: number, min?: number) => ({
    i,
    j,
    min,
    'a[j]': j !== undefined && j >= 0 ? a[j].value : undefined,
    'a[min]': min !== undefined && min >= 0 ? a[min].value : undefined,
  });

  yield {
    state: S({}),
    line: 'fn',
    note:
      n === 1
        ? `Only **one** element — it is already sorted.`
        : `Selection sort repeatedly **selects the smallest** remaining value and moves it to the front of the unsorted part. ${n} values → ${n - 1} passes.`,
    vars: V(),
    phase: 'select',
  };

  for (let i = 0; i < n - 1; i++) {
    let min = i;
    yield {
      state: S({ i, min, sorted: i }),
      line: ['outer', 'init'],
      note:
        i === 0
          ? `Pass 1: find the smallest value in the whole array. Until we see something smaller, assume it's **a[0] = ${a[0].value}**.`
          : `Pass ${i + 1}: **a[0..${i - 1}]** is final. Look for the smallest in **a[${i}..${n - 1}]**, starting with the guess **${a[i].value}**.`,
      vars: V(i, undefined, min),
      phase: 'select',
    };
    for (let j = i + 1; j < n; j++) {
      comps++;
      const smaller = a[j].value < a[min].value;
      yield {
        state: S({ i, j, min, cmp: true, sorted: i }),
        line: ['inner', 'cmp'],
        note: smaller
          ? `Is **${a[j].value} < ${a[min].value}**? Yes — a new smallest candidate!`
          : `Is **${a[j].value} < ${a[min].value}**? No — the current minimum **${a[min].value}** stays.`,
        vars: V(i, j, min),
        phase: 'select',
      };
      if (smaller) {
        min = j;
        yield {
          state: S({ i, j, min, sorted: i }),
          line: 'newmin',
          note: `Remember index **${j}** as the minimum (**${a[j].value}**). We still have to scan the rest — something even smaller might be hiding further right.`,
          vars: V(i, j, min),
          phase: 'select',
        };
      }
    }
    if (min !== i) {
      const lo = a[min].value;
      const hi = a[i].value;
      [a[i], a[min]] = [a[min], a[i]];
      swaps++;
      yield {
        state: S({ i, min: i, swapA: i, swapB: min, sorted: i }),
        line: ['check', 'swap'],
        note: `Scan finished: the smallest is **${lo}**. Swap it with **${hi}** at index ${i} — now index **${i}** holds its final value.`,
        vars: V(i, undefined, min),
        phase: 'select',
      };
    } else {
      yield {
        state: S({ i, min, sorted: i }),
        line: 'check',
        note: `Scan finished: **${a[i].value}** at index ${i} was already the smallest, so no swap is needed.`,
        vars: V(i, undefined, min),
        phase: 'select',
      };
    }
  }

  for (const f of sweepFronts(n)) {
    yield {
      state: S({ sorted: n, sweep: f }),
      line: 'done',
      note: n > 1 ? `After ${n - 1} passes the last element must be the largest — it's automatically in place. Sorted!` : 'Sorted!',
      vars: V(),
      phase: 'done',
    };
  }
  yield {
    state: S({ sorted: n, finished: true }),
    line: 'done',
    note: `Sorted with **${plural(comps, 'comparison')}** and just **${plural(swaps, 'swap')}**. Selection sort always does n(n−1)/2 comparisons, but never more than n−1 swaps.`,
    vars: V(),
    phase: 'done',
  };
}

function View({ frame }: { frame: Frame<State> }) {
  const { items, i, j, min, cmp, swapA, swapB, sorted, comps, swaps, sweep, finished } = frame.state;
  const n = items.length;
  const end = sweep >= 0 || finished;
  const tone = (k: number): Tone | undefined => {
    if (end) return finalTone(k, sweep);
    if (k === swapA || k === swapB) return 'swap';
    if (k < sorted) return 'done';
    if (k === j) return cmp ? 'compare' : 'frontier';
    if (k === min) return 'frontier';
    if (i >= 0 && k > i && j >= 0 && k < j) return 'visited';
    return undefined;
  };
  const pointers: Pointer[] = [
    { index: end ? -1 : i, label: 'i', tone: 'active', side: 'bottom' },
    { index: end || swapA >= 0 ? -1 : j, label: 'j', tone: 'compare', side: 'bottom' },
    { index: end ? -1 : min, label: 'min', tone: 'frontier', side: 'top' },
  ];
  return (
    <VizStack gap={22}>
      <StatRow
        stats={[
          { label: 'comparisons', value: comps, tone: 'compare' },
          { label: 'swaps', value: swaps, tone: 'swap' },
          { label: 'placed', value: `${Math.min(sorted, n)}/${n}`, tone: 'done' },
        ]}
      />
      <ArrayView
        items={items}
        variant="bars"
        tones={tone}
        pointers={pointers}
        spans={[
          end
            ? { from: 0, to: n - 1, label: 'sorted', tone: 'done', side: 'top' }
            : { from: Math.max(0, i), to: n - 1, label: n - Math.max(0, i) > 2 ? 'unsorted' : '', tone: 'frontier', side: 'top' },
        ]}
        maxValue={Math.max(1, ...items.map((x) => x.value))}
        cell={n > 12 ? 40 : 50}
      />
      <Callout show={finished} tone="found">
        sorted in {plural(comps, 'comparison')}, {plural(swaps, 'swap')}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const T = '4s';
  const xs = [14, 34, 54, 74, 94];
  const hs = [40, 30, 46, 14, 24];
  return (
    <svg viewBox="0 0 120 80">
      {xs.map((x, k) =>
        k === 0 ? (
          <g key={k}>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 0;60 0;60 0" keyTimes="0;0.62;0.8;1" dur={T} repeatCount="indefinite" />
            <rect x={x} y={62 - hs[k]} width={14} height={hs[k]} rx={3} fill="currentColor" fillOpacity={0.7} />
          </g>
        ) : k === 3 ? (
          <g key={k}>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 0;-60 0;-60 0" keyTimes="0;0.62;0.8;1" dur={T} repeatCount="indefinite" />
            <rect x={x} y={62 - hs[k]} width={14} height={hs[k]} rx={3} fill="currentColor" fillOpacity={0.7}>
              <animate attributeName="fill" values="currentColor;#a98bff;#5fd3a5;#5fd3a5" keyTimes="0;0.36;0.8;1" dur={T} repeatCount="indefinite" calcMode="discrete" />
              <animate attributeName="fill-opacity" values="0.7;1;1;1" keyTimes="0;0.36;0.8;1" dur={T} repeatCount="indefinite" calcMode="discrete" />
            </rect>
          </g>
        ) : (
          <rect key={k} x={x} y={62 - hs[k]} width={14} height={hs[k]} rx={3} fill="currentColor" fillOpacity={0.7} />
        ),
      )}
      <path d="M21 66 l-5 7 h10 z" fill="#ff6b5b">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0;20 0;40 0;60 0;80 0;80 0"
          keyTimes="0;0.12;0.24;0.36;0.48;1"
          dur={T}
          repeatCount="indefinite"
          calcMode="discrete"
        />
      </path>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'selection-sort',
  name: 'Selection Sort',
  category: 'sorting',
  order: 2,
  tagline: 'Scan for the smallest, swap it to the front, repeat.',
  description:
    'Selection sort splits the array into a **final** prefix and an unsorted rest. Each pass scans the rest for its **minimum** and swaps it into the first unsorted slot. It does lots of comparisons but at most **n − 1 swaps**, which helps when writes are expensive.',
  howItWorks: [
    'Start with `i = 0`: the whole array is unsorted.',
    'Guess `a[i]` is the minimum, then scan `j` across the rest, remembering any smaller value.',
    'Swap the minimum into position `i` — that slot is now final.',
    'Advance `i` and repeat until one element is left (it must be the largest).',
  ],
  complexity: { time: 'O(n²)', space: 'O(1)', note: 'Always n(n−1)/2 comparisons, even on sorted input. Not stable in this swap form.' },
  code: {
    js: `
function selectionSort(a) { //@fn
  for (let i = 0; i < a.length - 1; i++) { //@outer
    let min = i; //@init
    for (let j = i + 1; j < a.length; j++) { //@inner
      if (a[j] < a[min]) { //@cmp
        min = j; //@newmin
      }
    }
    if (min !== i) { //@check
      [a[i], a[min]] = [a[min], a[i]]; //@swap
    }
  }
  return a; //@done
}`,
    py: `
def selection_sort(a): #@fn
    for i in range(len(a) - 1): #@outer
        min_i = i #@init
        for j in range(i + 1, len(a)): #@inner
            if a[j] < a[min_i]: #@cmp
                min_i = j #@newmin
        if min_i != i: #@check
            a[i], a[min_i] = a[min_i], a[i] #@swap
    return a #@done`,
  },
  input: listInput({ def: [29, 72, 14, 55, 8, 91, 43, 66, 20], min: 1, max: 99, maxLen: 16, randLen: [6, 11] }),
  run,
  View,
  legend: [
    { tone: 'compare', label: 'scanning (j)' },
    { tone: 'frontier', label: 'current minimum' },
    { tone: 'visited', label: 'already scanned' },
    { tone: 'swap', label: 'swapping' },
    { tone: 'done', label: 'final position' },
  ],
  Glyph,
});
