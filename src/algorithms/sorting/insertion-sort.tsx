import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { withIds, type Item } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizStack, type Pointer } from '@/viz';
import { finalTone, listInput, plural, sweepFronts } from './_sortA';

type Input = number[];

interface State {
  items: Item[];
  i: number; // outer index (-1 before start)
  j: number; // index being compared (-1 = none)
  key: number; // position of the lifted key (-1 = nothing lifted)
  cur: number; // a[i] highlighted before lifting (-1 none)
  cmp: number; // element being compared with the key
  moved: number; // element just shifted right
  sorted: number; // indices < sorted belong to the sorted prefix
  comps: number;
  shifts: number;
  sweep: number; // celebratory sweep front (-1 none)
  finished: boolean;
}

const LIFT = 72;

function* run(input: Input): Generator<Frame<State>> {
  const a = withIds(input);
  const n = a.length;
  let comps = 0;
  let shifts = 0;
  const S = (p: Partial<State>): State => ({
    items: a.map((x) => ({ ...x })),
    i: -1,
    j: -1,
    key: -1,
    cur: -1,
    cmp: -1,
    moved: -1,
    sorted: 0,
    comps,
    shifts,
    sweep: -1,
    finished: false,
    ...p,
  });
  const V = (i?: number, j?: number, key?: number) => ({ i, j, key, 'a[j]': j !== undefined && j >= 0 ? a[j].value : undefined });

  yield {
    state: S({ sorted: Math.min(1, n) }),
    line: 'fn',
    note:
      n === 1
        ? `Only **one** element — a list of one is already sorted, so there is nothing to do.`
        : `Think of sorting a hand of cards: the first card on its own is already a sorted "hand", so we start by picking up the card at index **1**.`,
    vars: V(),
    phase: 'insert',
  };

  for (let i = 1; i < n; i++) {
    const keyVal = a[i].value;
    yield {
      state: S({ i, cur: i, sorted: i }),
      line: 'outer',
      note: `Everything left of **i = ${i}** is sorted. The next card to insert is **${keyVal}**.`,
      vars: V(i),
      phase: 'insert',
    };
    let p = i; // current key position (the gap)
    yield {
      state: S({ i, key: p, j: i - 1, sorted: i + 1 }),
      line: ['key', 'j'],
      note: `Lift **${keyVal}** out of the row, leaving a gap at index ${i}. We'll compare it with the sorted cards from right to left, starting at **j = ${i - 1}**.`,
      vars: V(i, i - 1, keyVal),
      phase: 'insert',
    };
    while (true) {
      const j = p - 1;
      if (j < 0) {
        yield {
          state: S({ i, key: p, j: -1, sorted: i + 1 }),
          line: 'cmp',
          note: `**j = -1** — we ran off the left edge. Nothing in the sorted part is ≤ **${keyVal}**, so it is the smallest so far and goes to the very front.`,
          vars: V(i, -1, keyVal),
          phase: 'insert',
        };
        break;
      }
      comps++;
      const bigger = a[j].value > keyVal;
      yield {
        state: S({ i, key: p, j, cmp: j, sorted: i + 1 }),
        line: 'cmp',
        note: bigger
          ? `Is **${a[j].value} > ${keyVal}**? Yes — ${a[j].value} is too big to sit left of the key, so it has to slide right.`
          : `Is **${a[j].value} > ${keyVal}**? No — ${a[j].value} ≤ ${keyVal}, so the key belongs right after it. Stop scanning${a[j].value === keyVal ? ' (equal values stay in order: insertion sort is **stable**)' : ''}.`,
        vars: V(i, j, keyVal),
        phase: 'insert',
      };
      if (!bigger) break;
      // shift a[j] right into the gap; the gap (and the hovering key) moves one step left
      [a[j], a[j + 1]] = [a[j + 1], a[j]];
      shifts++;
      p = j;
      yield {
        state: S({ i, key: p, j: j - 1, moved: j + 1, sorted: i + 1 }),
        line: ['shift', 'dec'],
        note: `Shift **${a[j + 1].value}** one step right into the gap. The gap is now at index **${j}**, and j moves left to **${j - 1}**.`,
        vars: V(i, j - 1, keyVal),
        phase: 'insert',
      };
    }
    yield {
      state: S({ i, cur: p, j: p - 1, sorted: i + 1 }),
      line: 'drop',
      note:
        p === i
          ? `Drop **${keyVal}** straight back where it was — it was already bigger than everything before it. Now **a[0..${i}]** is sorted.`
          : `Drop **${keyVal}** into the gap at index **${p}** (= j + 1). The sorted part grows to **a[0..${i}]**.`,
      vars: V(i, p - 1, keyVal),
      phase: 'insert',
    };
  }

  for (const f of sweepFronts(n)) {
    yield {
      state: S({ sorted: n, sweep: f }),
      line: 'done',
      note: `Every card has been inserted — the whole array is sorted.`,
      vars: V(),
      phase: 'done',
    };
  }
  yield {
    state: S({ sorted: n, finished: true }),
    line: 'done',
    note: `Sorted with **${plural(comps, 'comparison')}** and **${plural(shifts, 'shift')}**. On nearly-sorted input the inner loop barely runs, which is why insertion sort shines there.`,
    vars: V(),
    phase: 'done',
  };
}

function View({ frame }: { frame: Frame<State> }) {
  const { items, i, j, key, cur, cmp, moved, sorted, comps, shifts, sweep, finished } = frame.state;
  const n = items.length;
  const end = sweep >= 0 || finished;
  const tone = (k: number): Tone | undefined => {
    if (end) return finalTone(k, sweep);
    if (k === key || k === cur) return 'active';
    if (k === cmp) return 'compare';
    if (k === moved) return 'swap';
    if (k < sorted) return 'done';
    return undefined;
  };
  const pointers: Pointer[] = [
    { index: end ? -1 : i, label: 'i', tone: 'visited', side: 'bottom' },
    { index: !end && key >= 0 ? j : -1, label: 'j', tone: 'compare', side: 'bottom' },
    { index: end ? -1 : key, label: 'key', tone: 'active', side: 'top' },
  ];
  const maxV = Math.max(1, ...items.map((x) => x.value));
  return (
    <VizStack gap={22}>
      <StatRow
        stats={[
          { label: 'comparisons', value: comps, tone: 'compare' },
          { label: 'shifts', value: shifts, tone: 'swap' },
          { label: 'sorted', value: `${Math.min(sorted, n)}/${n}`, tone: 'done' },
        ]}
      />
      <ArrayView
        items={items}
        variant="bars"
        tones={tone}
        pointers={pointers}
        spans={[{ from: 0, to: Math.max(0, Math.min(sorted, n) - 1), label: 'sorted', tone: 'done' }]}
        offsets={key >= 0 ? { [key]: { dy: -LIFT } } : {}}
        reserveLift={LIFT + 18}
        maxValue={maxV}
        cell={n > 12 ? 40 : 50}
        barHeight={170}
      />
      <Callout show={finished} tone="found">
        sorted in {plural(comps, 'comparison')}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const T = '4s';
  const bars = [
    { x: 16, h: 24, kt: '0;0.45;0.6;1' },
    { x: 40, h: 36, kt: '0;0.3;0.45;1' },
    { x: 64, h: 50, kt: '0;0.15;0.3;1' },
  ];
  return (
    <svg viewBox="0 0 120 80">
      <line x1={10} x2={110} y1={68} y2={68} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="3 4" />
      {bars.map((b) => (
        <g key={b.x}>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 0;24 0;24 0" keyTimes={b.kt} dur={T} repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;.4 0 .2 1;0 0 1 1" />
          <rect x={b.x} y={66 - b.h} width={16} height={b.h} rx={3} fill="currentColor" fillOpacity={0.75} />
        </g>
      ))}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0;0 -28;-24 -28;-48 -28;-72 -28;-72 0;-72 0"
          keyTimes="0;0.15;0.3;0.45;0.6;0.75;1"
          dur={T}
          repeatCount="indefinite"
        />
        <rect x={88} y={50} width={16} height={16} rx={3} fill="#f5b544" />
      </g>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'insertion-sort',
  name: 'Insertion Sort',
  category: 'sorting',
  order: 1,
  tagline: 'Pick up the next card and slide it into place in the sorted hand.',
  description:
    'Insertion sort grows a **sorted prefix** one element at a time. It lifts the next element (the **key**), shifts every larger sorted element one step right, and drops the key into the gap that opens up. Simple, **stable**, in-place — and very fast on nearly-sorted data.',
  howItWorks: [
    'Treat `a[0]` as a sorted list of one.',
    'Lift the next element `a[i]` out as the **key**.',
    'Walk left through the sorted part: every element bigger than the key shifts one slot right.',
    'Stop at the first element ≤ key (or the left edge) and drop the key into the gap.',
    'Repeat until `i` reaches the end.',
  ],
  complexity: { time: 'O(n²)', space: 'O(1)', note: 'Best case O(n) on already-sorted input — each key needs only one comparison.' },
  code: {
    js: `
function insertionSort(a) { //@fn
  for (let i = 1; i < a.length; i++) { //@outer
    const key = a[i]; //@key
    let j = i - 1; //@j
    while (j >= 0 && a[j] > key) { //@cmp
      a[j + 1] = a[j]; //@shift
      j--; //@dec
    }
    a[j + 1] = key; //@drop
  }
  return a; //@done
}`,
    py: `
def insertion_sort(a): #@fn
    for i in range(1, len(a)): #@outer
        key = a[i] #@key
        j = i - 1 #@j
        while j >= 0 and a[j] > key: #@cmp
            a[j + 1] = a[j] #@shift
            j -= 1 #@dec
        a[j + 1] = key #@drop
    return a #@done`,
  },
  input: listInput({ def: [38, 12, 67, 25, 90, 7, 51, 33, 74], min: 1, max: 99, maxLen: 16, randLen: [6, 11] }),
  run,
  View,
  legend: [
    { tone: 'active', label: 'key (lifted)' },
    { tone: 'compare', label: 'compared with key' },
    { tone: 'swap', label: 'shifted right' },
    { tone: 'done', label: 'sorted prefix' },
  ],
  Glyph,
});
