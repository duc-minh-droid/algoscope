import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { withIds, type Item } from '@/core/utils';
import { ArrayView, Callout, StatRow, TreeView, VizSection, VizStack, type TreeNode } from '@/viz';
import { finalTone, listInput, plural, sweepFronts } from './_sortA';

type Input = number[];

interface State {
  items: Item[];
  end: number; // heap size: indices < end are in the heap, the rest are sorted
  hi: Record<number, Tone>; // per-index highlight
  edge: { p: number; c: number; tone: Tone } | null; // highlighted parent→child edge (indices)
  i: number; // node being sifted (-1 none)
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
  let end = n;
  const S = (p: Partial<State>): State => ({
    items: a.map((x) => ({ ...x })),
    end,
    hi: {},
    edge: null,
    i: -1,
    comps,
    swaps,
    sweep: -1,
    finished: false,
    ...p,
  });
  const V = (i?: number, l?: number, r?: number, largest?: number) => ({ heapSize: end, i, l, r, largest });

  function* sift(start: number, phase: string): Generator<Frame<State>> {
    let i = start;
    while (true) {
      const l = 2 * i + 1;
      const r = l + 1;
      const lIn = l < end ? l : undefined;
      const rIn = r < end ? r : undefined;
      if (l >= end) {
        yield {
          state: S({ i, hi: { [i]: 'active' } }),
          line: ['kids', 'stop'],
          note: `**${a[i].value}** (index ${i}) has no children inside the heap (2·${i}+1 = ${l} ≥ ${end}), so it can't sink any further.`,
          vars: V(i, lIn, rIn, i),
          phase,
        };
        return;
      }
      let big = i;
      comps++;
      const lBig = a[l].value > a[big].value;
      yield {
        state: S({ i, hi: { [i]: 'active', [l]: 'compare' }, edge: { p: i, c: l, tone: 'compare' } }),
        line: ['kids', 'cmpL'],
        note: `Children of index ${i} live at **2i+1 = ${l}**${r < end ? ` and **2i+2 = ${r}**` : ''}. Left child: is **${a[l].value} > ${a[i].value}**? ${lBig ? 'Yes — it becomes the largest so far.' : 'No — the parent is still the largest.'}`,
        vars: V(i, lIn, rIn, lBig ? l : i),
        phase,
      };
      if (lBig) big = l;
      if (r < end) {
        comps++;
        const rBig = a[r].value > a[big].value;
        const hi: Record<number, Tone> = { [i]: 'active', [r]: 'compare' };
        if (big === l) hi[l] = 'frontier';
        yield {
          state: S({ i, hi, edge: { p: i, c: r, tone: 'compare' } }),
          line: 'cmpR',
          note: `Right child: is **${a[r].value} > ${a[big].value}** (the largest so far)? ${rBig ? `Yes — **${a[r].value}** is the largest of the three.` : `No — **${a[big].value}** stays the largest.`}`,
          vars: V(i, lIn, rIn, rBig ? r : big),
          phase,
        };
        if (rBig) big = r;
      }
      if (big === i) {
        yield {
          state: S({ i, hi: { [i]: 'found' } }),
          line: 'stop',
          note: `**${a[i].value}** is at least as big as its children — the heap property holds here, so sifting stops.`,
          vars: V(i, lIn, rIn, big),
          phase,
        };
        return;
      }
      const pv = a[i].value;
      const cv = a[big].value;
      [a[i], a[big]] = [a[big], a[i]];
      swaps++;
      yield {
        state: S({ i: big, hi: { [i]: 'swap', [big]: 'swap' }, edge: { p: i, c: big, tone: 'swap' } }),
        line: 'swap',
        note: `A parent must be ≥ its children, so swap: **${cv}** rises to index ${i}, **${pv}** sinks to index ${big}. Keep sifting ${pv} down from there.`,
        vars: V(big, lIn, rIn, big),
        phase,
      };
      i = big;
    }
  }

  yield {
    state: S({}),
    line: 'fn',
    note:
      n === 1
        ? `A single element is already a heap and already sorted.`
        : `The array doubles as a binary tree: index **i** has children **2i+1** and **2i+2**. First we rearrange it into a **max-heap** (every parent ≥ its children).`,
    vars: V(),
    phase: 'build heap',
  };

  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
    yield {
      state: S({ i, hi: { [i]: 'active' } }),
      line: 'build',
      note:
        i === Math.floor(n / 2) - 1
          ? `Leaves are trivially heaps, so start at the last parent, index **${i}** (⌊n/2⌋−1), and sift it down.`
          : `Next parent up: index **${i}** (**${a[i].value}**). Its subtrees are already heaps — sift it down to merge them.`,
      vars: V(i),
      phase: 'build heap',
    };
    yield* sift(i, 'build heap');
  }

  if (n > 1) {
    yield {
      state: S({ hi: { 0: 'found' } }),
      line: 'build',
      note: `Max-heap built! The largest value, **${a[0].value}**, sits at the root (index 0). Now we repeatedly move the root to the end.`,
      vars: V(),
      phase: 'sort down',
    };
  }

  for (let e = n - 1; e > 0; e--) {
    const top = a[0].value;
    const last = a[e].value;
    [a[0], a[e]] = [a[e], a[0]];
    swaps++;
    end = e;
    yield {
      state: S({ hi: { 0: 'swap', [e]: 'swap' }, edge: null }),
      line: ['extract', 'swapEnd'],
      note: `Swap the max **${top}** with the last heap element **${last}**. ${top} is now in its final place at index **${e}**; the heap shrinks to ${e} element${e === 1 ? '' : 's'}.`,
      vars: V(0),
      phase: 'sort down',
    };
    if (e > 1) yield* sift(0, 'sort down');
  }

  end = 0;
  for (const f of sweepFronts(n)) {
    yield {
      state: S({ sweep: f }),
      line: 'done',
      note: `Only one element left in the heap — the smallest — and it's already at index 0. Sorted!`,
      vars: V(),
      phase: 'done',
    };
  }
  yield {
    state: S({ finished: true }),
    line: 'done',
    note: `Sorted with **${plural(comps, 'comparison')}** and **${plural(swaps, 'swap')}**, in place, with a guaranteed O(n log n) — no bad inputs for heap sort.`,
    vars: V(),
    phase: 'done',
  };
}

function View({ frame }: { frame: Frame<State> }) {
  const { items, end, hi, edge, i, comps, swaps, sweep, finished } = frame.state;
  const n = items.length;
  const over = sweep >= 0 || finished;
  const tone = (k: number): Tone | undefined => {
    if (over) return finalTone(k, sweep);
    if (hi[k]) return hi[k];
    if (k >= end) return 'done';
    return undefined;
  };
  const nodes: TreeNode[] = items.map((it, k) => ({
    id: it.id,
    label: it.value,
    sub: `[${k}]`,
    tone: tone(k),
    children: [2 * k + 1, 2 * k + 2].filter((c) => c < n).map((c) => items[c].id),
  }));
  const edgeTones: Record<string, Tone | undefined> = {};
  for (let c = 1; c < n; c++) {
    const p = (c - 1) >> 1;
    const key = `${items[p].id}-${items[c].id}`;
    if (!over && c >= end) edgeTones[key] = 'muted';
  }
  if (edge && !over) edgeTones[`${items[edge.p].id}-${items[edge.c].id}`] = edge.tone;

  return (
    <VizStack gap={16}>
      <StatRow
        stats={[
          { label: 'comparisons', value: comps, tone: 'compare' },
          { label: 'swaps', value: swaps, tone: 'swap' },
          { label: 'heap size', value: over ? 0 : end, tone: 'frontier' },
          { label: 'sorted', value: over ? n : n - end, tone: 'done' },
        ]}
      />
      <VizSection label="implicit binary tree" aside="children of i → 2i+1, 2i+2">
        <TreeView nodes={nodes} roots={n ? [items[0].id] : []} edgeTones={edgeTones} nodeSize={38} levelGap={62} siblingGap={12} minHeight={150} />
      </VizSection>
      <VizSection label="the same array">
        <ArrayView
          items={items}
          variant="bars"
          tones={tone}
          barHeight={110}
          cell={n > 11 ? 38 : 44}
          maxValue={Math.max(1, ...items.map((x) => x.value))}
          pointers={[{ index: over ? -1 : i, label: 'i', tone: 'active', side: 'bottom' }]}
          spans={[
            over || end === 0
              ? { from: 0, to: n - 1, label: 'sorted', tone: 'done', side: 'top' }
              : { from: 0, to: end - 1, label: end > 1 ? 'heap' : '', tone: 'frontier', side: 'top' },
          ]}
        />
      </VizSection>
      <Callout show={finished} tone="found">
        sorted in {plural(comps, 'comparison')}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const T = '4.5s';
  return (
    <svg viewBox="0 0 120 80">
      <line x1={60} y1={16} x2={34} y2={44} stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} />
      <line x1={60} y1={16} x2={86} y2={44} stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} />
      {[0, 1, 2, 3].map((k) => (
        <rect key={k} x={24 + k * 18} y={66} width={14} height={8} rx={2} fill="currentColor" fillOpacity={0.25} />
      ))}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;26 28;26 28" keyTimes="0;0.25;0.45;1" dur={T} repeatCount="indefinite" />
        <circle cx={60} cy={16} r={10} fill="#ff6b5b" />
      </g>
      <circle cx={34} cy={44} r={10} fill="currentColor" fillOpacity={0.8} />
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;-26 -28;-26 -28;-1 26;-1 26" keyTimes="0;0.25;0.45;0.6;0.8;1" dur={T} repeatCount="indefinite" />
        <circle cx={86} cy={44} r={10} fill="#ff5fa2">
          <animate attributeName="r" values="10;10;10;4;4" keyTimes="0;0.25;0.6;0.8;1" dur={T} repeatCount="indefinite" />
          <animate attributeName="fill" values="#ff5fa2;#ff5fa2;#5fd3a5;#5fd3a5" keyTimes="0;0.6;0.8;1" dur={T} repeatCount="indefinite" calcMode="discrete" />
        </circle>
      </g>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'heap-sort',
  name: 'Heap Sort',
  category: 'sorting',
  order: 3,
  tagline: 'Turn the array into a max-heap, then pluck the max off the top again and again.',
  description:
    'Heap sort views the array as an implicit **binary tree** (children of `i` at `2i+1`, `2i+2`). It first **builds a max-heap** — every parent ≥ its children — so the largest value is at the root. Then it swaps the root to the end, shrinks the heap by one and **sifts** the new root down to repair it.',
  howItWorks: [
    'Build: sift down every parent, from the last one (`⌊n/2⌋−1`) back to the root.',
    'Sift down: compare a node with its children; swap with the larger child until the parent wins.',
    'Sort down: swap the root (max) with the last heap element — it is now final.',
    'Shrink the heap by one and sift the new root down. Repeat until one element is left.',
  ],
  complexity: { time: 'O(n log n)', space: 'O(1)', note: 'Building the heap is O(n); each of the n extractions sifts through O(log n) levels. Not stable.' },
  code: {
    js: `
function heapSort(a) { //@fn
  const n = a.length;
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) //@build
    siftDown(a, i, n);
  for (let end = n - 1; end > 0; end--) { //@extract
    [a[0], a[end]] = [a[end], a[0]]; //@swapEnd
    siftDown(a, 0, end);
  }
  return a; //@done
}
function siftDown(a, i, n) {
  while (true) {
    const l = 2 * i + 1, r = l + 1; //@kids
    let big = i;
    if (l < n && a[l] > a[big]) big = l; //@cmpL
    if (r < n && a[r] > a[big]) big = r; //@cmpR
    if (big === i) return; //@stop
    [a[i], a[big]] = [a[big], a[i]]; //@swap
    i = big;
  }
}`,
    py: `
def heap_sort(a): #@fn
    n = len(a)
    for i in range(n // 2 - 1, -1, -1): #@build
        sift_down(a, i, n)
    for end in range(n - 1, 0, -1): #@extract
        a[0], a[end] = a[end], a[0] #@swapEnd
        sift_down(a, 0, end)
    return a #@done

def sift_down(a, i, n):
    while True:
        l, r = 2 * i + 1, 2 * i + 2 #@kids
        big = i
        if l < n and a[l] > a[big]: big = l #@cmpL
        if r < n and a[r] > a[big]: big = r #@cmpR
        if big == i: return #@stop
        a[i], a[big] = a[big], a[i] #@swap
        i = big`,
  },
  input: listInput({ def: [41, 17, 83, 29, 64, 8, 52, 95, 36, 70], min: 1, max: 99, maxLen: 14, randLen: [6, 11] }),
  run,
  View,
  legend: [
    { tone: 'active', label: 'sifting node' },
    { tone: 'compare', label: 'child compared' },
    { tone: 'frontier', label: 'largest so far / heap' },
    { tone: 'swap', label: 'swapping' },
    { tone: 'done', label: 'sorted (out of heap)' },
  ],
  Glyph,
});
