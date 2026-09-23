import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, randInt, randomArray } from '@/core/utils';
import { Callout, StatRow, VizStack, toneFill } from '@/viz';
import { Caret, Glide, SortBStyle, TileBody, inkOf, listText, parseSortList, sketchRect } from './_sortB';

type Input = number[];
type Zone = 'main' | 'L' | 'R';
type CallStatus = 'hidden' | 'idle' | 'active' | 'waiting' | 'done';

interface MTile {
  id: number;
  value: number;
  zone: Zone;
  pos: number; // main-array column (workspace rows sit directly under their columns)
  tone?: Tone;
}

interface Call {
  key: string;
  lo: number;
  hi: number;
  depth: number;
  parent: string | null;
  status: CallStatus;
  vals: number[];
}

interface State {
  tiles: MTile[];
  calls: Call[];
  lo: number;
  hi: number;
  cut: number; // mid while splitting, else -1
  merge: { lo: number; mid: number; hi: number } | null;
  i: number; // column of L[i] (-1 hidden)
  j: number; // column of R[j]
  k: number; // column being written
  cmps: number;
  writes: number;
  finished: boolean;
}

const key = (lo: number, hi: number) => `${lo}-${hi}`;

function* run(arr: Input): Generator<Frame<State>> {
  const n = arr.length;
  const tiles: MTile[] = arr.map((value, id) => ({ id, value, zone: 'main', pos: id }));
  const calls: Call[] = [];
  const build = (lo: number, hi: number, depth: number, parent: string | null) => {
    calls.push({ key: key(lo, hi), lo, hi, depth, parent, status: parent ? 'hidden' : 'idle', vals: arr.slice(lo, hi + 1) });
    if (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      build(lo, mid, depth + 1, key(lo, hi));
      build(mid + 1, hi, depth + 1, key(lo, hi));
    }
  };
  build(0, n - 1, 0, null);
  const call = (lo: number, hi: number) => calls.find((c) => c.key === key(lo, hi))!;
  const at = (p: number) => tiles.find((t) => t.zone === 'main' && t.pos === p)!;
  const valsAt = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, t) => at(lo + t).value);

  let cmps = 0;
  let writes = 0;
  const cur = { lo: -1, hi: -1, cut: -1, merge: null as State['merge'], i: -1, j: -1, k: -1 };
  const S = (finished = false): State => structuredClone({ tiles, calls, ...cur, cmps, writes, finished });
  const V = (o: { mid?: number; i?: number; j?: number; k?: number; L?: number[]; R?: number[] } = {}) => ({
    lo: cur.lo < 0 ? undefined : cur.lo,
    hi: cur.hi < 0 ? undefined : cur.hi,
    mid: o.mid,
    L: o.L,
    R: o.R,
    i: o.i,
    j: o.j,
    k: o.k,
  });
  const lines = (via: string | null, ...rest: string[]) => (via ? [via, ...rest] : rest);

  yield {
    state: S(),
    line: 'fn',
    note: `Merge sort is **divide & conquer**: keep cutting the list in half until every piece has one element (trivially sorted), then **merge** sorted pieces back together. The tree above will grow as we split.`,
    vars: V(),
    phase: 'split',
  };

  function* sort(lo: number, hi: number, via: string | null): Generator<Frame<State>> {
    const c = call(lo, hi);
    c.status = 'active';
    c.vals = valsAt(lo, hi);
    cur.lo = lo;
    cur.hi = hi;
    cur.cut = -1;
    if (lo >= hi) {
      c.status = 'done';
      at(lo).tone = 'visited';
      yield {
        state: S(),
        line: lines(via, 'fn', 'base'),
        note: `\`mergeSort(${lo}, ${hi})\`: just **${at(lo).value}** — a list of one element is already sorted, so this call returns right away.`,
        vars: V(),
        phase: 'split',
      };
      return;
    }
    yield {
      state: S(),
      line: lines(via, 'fn'),
      note: `\`mergeSort(${lo}, ${hi})\` must sort **${listText(c.vals)}**. It has ${hi - lo + 1} elements, so it's not trivially sorted — split it.`,
      vars: V(),
      phase: 'split',
    };
    const mid = Math.floor((lo + hi) / 2);
    cur.cut = mid;
    for (const ch of [call(lo, mid), call(mid + 1, hi)]) {
      ch.status = 'idle';
      ch.vals = valsAt(ch.lo, ch.hi);
    }
    yield {
      state: S(),
      line: 'mid',
      note: `mid = ⌊(${lo} + ${hi}) / 2⌋ = **${mid}**. Cut into left **${listText(valsAt(lo, mid))}** and right **${listText(valsAt(mid + 1, hi))}**; each half is sorted by its own recursive call.`,
      vars: V({ mid }),
      phase: 'split',
    };
    c.status = 'waiting';
    cur.cut = -1;
    yield* sort(lo, mid, 'left');
    yield* sort(mid + 1, hi, 'right');

    // ---- merge ----
    c.status = 'active';
    cur.lo = lo;
    cur.hi = hi;
    const final = lo === 0 && hi === n - 1;
    const L = Array.from({ length: mid - lo + 1 }, (_, t) => at(lo + t));
    const R = Array.from({ length: hi - mid }, (_, t) => at(mid + 1 + t));
    L.forEach((t) => (t.zone = 'L'));
    R.forEach((t) => (t.zone = 'R'));
    const Lv = L.map((t) => t.value);
    const Rv = R.map((t) => t.value);
    cur.merge = { lo, mid, hi };
    cur.i = lo;
    cur.j = mid + 1;
    cur.k = lo;
    yield {
      state: S(),
      line: ['merge', 'copy'],
      note: `Both halves are sorted. Copy them down into **L = ${listText(Lv)}** and **R = ${listText(Rv)}**, then refill a[${lo}..${hi}] slot by slot, always taking the smaller front element.`,
      vars: V({ mid, i: 0, j: 0, k: lo, L: Lv, R: Rv }),
      phase: 'merge',
    };
    let i = 0;
    let j = 0;
    let k = lo;
    const settle = (t: MTile) => (t.tone = final ? 'done' : 'visited');
    const write = (t: MTile) => {
      t.zone = 'main';
      t.pos = k;
      t.tone = 'swap';
      writes++;
    };
    while (i < L.length && j < R.length) {
      const a = L[i];
      const b = R[j];
      a.tone = 'compare';
      b.tone = 'compare';
      cmps++;
      const takeL = a.value <= b.value;
      yield {
        state: S(),
        line: ['loop', 'cmp'],
        note: takeL
          ? `Compare fronts: L[${i}] = **${a.value}** vs R[${j}] = **${b.value}**. ${a.value === b.value ? 'A tie goes to L — that keeps equal values in their original order (merge sort is **stable**).' : `${a.value} is smaller, so it's the next value in sorted order.`}`
          : `Compare fronts: L[${i}] = **${a.value}** vs R[${j}] = **${b.value}**. ${b.value} is smaller, so R's front goes next.`,
        vars: V({ mid, i, j, k, L: Lv, R: Rv }),
        phase: 'merge',
      };
      const t = takeL ? a : b;
      (takeL ? b : a).tone = 'visited';
      write(t);
      if (takeL) i++;
      else j++;
      k++;
      cur.i = i < L.length ? lo + i : -1;
      cur.j = j < R.length ? mid + 1 + j : -1;
      cur.k = k <= hi ? k : -1;
      yield {
        state: S(),
        line: takeL ? 'takeL' : 'takeR',
        note: `Write **${t.value}** into a[${k - 1}]${final ? ' — this is the last merge, so that slot is **final**' : ''}. Advance ${takeL ? 'i' : 'j'} and k.`,
        vars: V({ mid, i, j, k, L: Lv, R: Rv }),
        phase: 'merge',
      };
      settle(t);
    }
    while (i < L.length || j < R.length) {
      const fromL = i < L.length;
      const t = fromL ? L[i] : R[j];
      write(t);
      if (fromL) i++;
      else j++;
      k++;
      cur.i = i < L.length ? lo + i : -1;
      cur.j = j < R.length ? mid + 1 + j : -1;
      cur.k = k <= hi ? k : -1;
      yield {
        state: S(),
        line: fromL ? 'restL' : 'restR',
        note: `${fromL ? 'R' : 'L'} is used up, so no more comparisons are needed: the leftover ${fromL ? 'L' : 'R'} values are already sorted and just copy across. a[${k - 1}] = **${t.value}**.`,
        vars: V({ mid, i, j, k, L: Lv, R: Rv }),
        phase: 'merge',
      };
      settle(t);
    }
    cur.merge = null;
    cur.i = cur.j = cur.k = -1;
    c.status = 'done';
    c.vals = valsAt(lo, hi);
    yield {
      state: S(),
      line: 'merge',
      note: final
        ? `The last merge is complete: the whole array **${listText(c.vals)}** is sorted.`
        : `a[${lo}..${hi}] is now the sorted run **${listText(c.vals)}**. This call returns to its parent, which is waiting to merge it with its sibling.`,
      vars: V({ mid }),
      phase: 'merge',
    };
  }

  yield* sort(0, n - 1, null);
  tiles.forEach((t) => (t.tone = 'done'));
  calls.forEach((c) => (c.status = 'done'));
  cur.lo = cur.hi = -1;
  yield {
    state: S(true),
    line: 'fn',
    note: `Sorted in **${cmps}** comparisons and **${writes}** writes. Each of the ~log₂(${n}) = ${Math.ceil(Math.log2(Math.max(n, 1)))} levels of the tree costs at most n writes — that's where **O(n log n)** comes from.`,
    vars: V(),
    phase: 'done',
  };
}

// ---------------------------------------------------------------- View

const U = 56; // column stride
const C = 46; // tile size
const LV = 42; // tree level height
const TH = 28; // tree box height

const statusLook: Record<CallStatus, { fill: string; fo: number; stroke: string; dash?: string; text: string }> = {
  hidden: { fill: 'var(--ink-2)', fo: 1, stroke: 'var(--line-strong)', text: 'var(--paper-dim)' },
  idle: { fill: 'var(--ink-2)', fo: 1, stroke: 'rgba(236,230,214,0.35)', text: 'var(--paper-dim)' },
  active: { fill: toneFill('active'), fo: 0.2, stroke: toneFill('active'), text: 'var(--paper)' },
  waiting: { fill: toneFill('frontier'), fo: 0.1, stroke: toneFill('frontier'), dash: '5 4', text: 'var(--paper-dim)' },
  done: { fill: toneFill('done'), fo: 0.14, stroke: toneFill('done'), text: 'var(--paper)' },
};

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const n = s.tiles.length;
  const levels = Math.max(...s.calls.map((c) => c.depth)) + 1;
  const rowW = n * U - (U - C);
  const W = Math.max(rowW + 40, 400);
  const ox = (W - rowW) / 2;
  const xOf = (p: number) => ox + p * U;
  const treeTop = 12;
  const mainY = treeTop + levels * LV + 36;
  const wsY = mainY + C + 78;
  const H = wsY + C + 38;
  const byKey = new Map(s.calls.map((c) => [c.key, c]));
  const inRange = (p: number) => s.finished || s.lo < 0 || (p >= s.lo && p <= s.hi);
  const m = s.merge;

  const boxOf = (c: Call) => ({ x: xOf(c.lo) - 3, y: treeTop + c.depth * LV, w: (c.hi - c.lo + 1) * U - (U - C) + 6 });

  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'comparisons', value: s.cmps, tone: 'compare' },
          { label: 'writes', value: s.writes, tone: 'swap' },
          { label: 'current call', value: s.lo < 0 ? '—' : `[${s.lo}..${s.hi}]` },
          { label: 'phase', value: s.finished ? 'sorted' : m ? 'merge' : 'split' },
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.35, margin: '0 auto', display: 'block', overflow: 'visible' }} role="img" aria-label="merge sort recursion tree and array">
        <SortBStyle roughId="msort-rough" />

        {/* recursion tree edges */}
        {s.calls.map((c) => {
          if (!c.parent) return null;
          const p = byKey.get(c.parent)!;
          const a = boxOf(p);
          const b = boxOf(c);
          const tone = c.status === 'done' ? toneFill('done') : c.status === 'active' ? toneFill('active') : 'rgba(236,230,214,0.22)';
          return (
            <path
              key={`e${c.key}`}
              className="sortb-paint"
              d={`M${a.x + a.w / 2} ${a.y + TH} C${a.x + a.w / 2} ${a.y + TH + 8} ${b.x + b.w / 2} ${b.y - 8} ${b.x + b.w / 2} ${b.y}`}
              fill="none"
              strokeWidth={1.6}
              style={{ stroke: tone, opacity: c.status === 'hidden' ? 0 : 1 }}
            />
          );
        })}
        {/* recursion tree nodes */}
        {s.calls.map((c) => {
          const self = boxOf(c);
          const anchor = c.status === 'hidden' && c.parent ? boxOf(byKey.get(c.parent)!) : self;
          const look = statusLook[c.status];
          const dx = anchor.x + (anchor.w - self.w) / 2;
          return (
            <g key={c.key} className="sortb-move" style={{ transform: `translate(${dx}px, ${anchor.y}px)`, opacity: c.status === 'hidden' ? 0 : 1 }}>
              <rect className="sortb-paint" width={self.w} height={TH} rx={8} style={{ fill: look.fill, fillOpacity: look.fo }} />
              <path
                key={c.status === 'hidden' ? 'h' : 'v'}
                className={`sortb-paint ${c.status === 'hidden' ? '' : 'sortb-draw'}`}
                d={sketchRect(0, 0, self.w, TH, c.lo * 31 + c.hi * 7 + 3)}
                pathLength={1}
                fill="none"
                strokeWidth={c.status === 'active' ? 2.2 : 1.5}
                strokeLinejoin="round"
                filter="url(#msort-rough)"
                style={{ stroke: look.stroke }}
              />
              {c.status === 'waiting' && (
                <rect width={self.w} height={TH} rx={8} fill="none" strokeWidth={1.4} strokeDasharray={look.dash} style={{ stroke: look.stroke }} />
              )}
              {c.vals.map((v, t) => (
                <text key={t} className="sortb-val sortb-paint" x={3 + t * U + C / 2} y={TH / 2 + 4.5} fontSize={13} style={{ fill: look.text }}>
                  {v}
                </text>
              ))}
            </g>
          );
        })}
        <text className="sortb-small" x={8} y={treeTop + 18} textAnchor="start" style={{ textAnchor: 'start' }}>
          calls
        </text>

        {/* main array slots */}
        {Array.from({ length: n }, (_, p) => (
          <g key={`slot${p}`}>
            <rect x={xOf(p)} y={mainY} width={C} height={C} rx={9} fill="none" stroke="var(--line-strong)" strokeDasharray="4 4" />
            <text className="sortb-small" x={xOf(p) + C / 2} y={mainY + C + 15}>
              {p}
            </text>
          </g>
        ))}
        <text className="sortb-small" x={8} y={mainY + C / 2 + 4} style={{ textAnchor: 'start' }}>
          a
        </text>

        {/* current range bracket */}
        <g className="sortb-fade" style={{ opacity: s.lo >= 0 && !s.finished ? 1 : 0 }}>
          {s.lo >= 0 && (
            <g>
              <path
                d={`M${xOf(s.lo) + 2} ${mainY + C + 22} L${xOf(s.lo) + 2} ${mainY + C + 27} L${xOf(s.hi) + C - 2} ${mainY + C + 27} L${xOf(s.hi) + C - 2} ${mainY + C + 22}`}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                style={{ stroke: toneFill('active') }}
              />
              <text className="sortb-val" x={(xOf(s.lo) + xOf(s.hi) + C) / 2} y={mainY + C + 41} fontSize={11.5} style={{ fill: toneFill('active') }}>
                {s.lo === s.hi ? `[${s.lo}]` : `lo=${s.lo} … hi=${s.hi}`}
              </text>
            </g>
          )}
        </g>

        {/* split cut */}
        {s.cut >= 0 && (
          <g key={`cut${s.lo}-${s.cut}`}>
            <path
              className="sortb-draw"
              pathLength={1}
              d={`M${xOf(s.cut) + C + (U - C) / 2} ${mainY - 14} L${xOf(s.cut) + C + (U - C) / 2} ${mainY + C + 10}`}
              strokeWidth={2.4}
              strokeLinecap="round"
              fill="none"
              style={{ stroke: toneFill('danger') }}
            />
            <text className="sortb-hand sortb-pop" x={xOf(s.cut) + C + (U - C) / 2} y={mainY - 18} fontSize={15} style={{ fill: toneFill('danger') }}>
              ✂ mid
            </text>
          </g>
        )}

        {/* merge workspace */}
        <text className="sortb-hand sortb-fade" x={W / 2} y={wsY + C / 2 + 6} fontSize={18} style={{ fill: 'var(--paper-faint)', opacity: m || s.finished ? 0 : 0.7 }}>
          merge workspace
        </text>
        {m && (
          <g key={`ws${m.lo}-${m.hi}`} className="sortb-pop">
            {[
              { lab: 'L', a: m.lo, b: m.mid, seed: 11 },
              { lab: 'R', a: m.mid + 1, b: m.hi, seed: 23 },
            ].map((h) => (
              <g key={h.lab}>
                <path
                  className="sortb-draw"
                  pathLength={1}
                  d={sketchRect(xOf(h.a) - 5, wsY - 5, (h.b - h.a + 1) * U - (U - C) + 10, C + 10, h.seed + m.lo)}
                  fill="none"
                  strokeWidth={1.6}
                  filter="url(#msort-rough)"
                  style={{ stroke: 'var(--paper-dim)' }}
                />
                <text className="sortb-hand" x={xOf(h.a) - 5} y={wsY - 11} fontSize={16} style={{ fill: 'var(--paper-dim)', textAnchor: 'start' }}>
                  {h.lab}
                </text>
              </g>
            ))}
          </g>
        )}

        {/* tiles */}
        {s.tiles.map((t) => {
          const y = t.zone === 'main' ? mainY : wsY;
          const dim = t.zone === 'main' && !inRange(t.pos);
          return (
            <Glide key={t.id} x={xOf(t.pos)} y={y} opacity={dim ? 0.4 : 1}>
              <TileBody w={C} h={C} tone={t.tone}>
                <text className="sortb-val" x={C / 2} y={C / 2 + 5.5} fontSize={String(t.value).length > 2 ? 14 : 16} style={{ fill: inkOf(t.tone) }}>
                  {t.value}
                </text>
              </TileBody>
            </Glide>
          );
        })}

        {/* pointers */}
        <Caret x={xOf(Math.max(0, s.k)) + C / 2} y={mainY - 4} label="k" tone="swap" hidden={s.k < 0} />
        <Caret x={xOf(Math.max(0, s.i)) + C / 2} y={wsY + C + 4} label="i" tone="compare" up={false} hidden={s.i < 0} />
        <Caret x={xOf(Math.max(0, s.j)) + C / 2} y={wsY + C + 4} label="j" tone="compare" up={false} hidden={s.j < 0} />
      </svg>
      <Callout show={s.finished} tone="done">
        sorted: {s.tiles.slice().sort((a, b) => a.pos - b.pos).map((t) => t.value).join(' · ')}
      </Callout>
    </VizStack>
  );
}

// ---------------------------------------------------------------- Glyph

function Glyph() {
  const bars = [
    { x: 30, h: 28, dx: '0;0;-8;8;48;48' },
    { x: 46, h: 12, dx: '0;0;-8;-24;0;0' },
    { x: 62, h: 22, dx: '0;0;8;24;0;0' },
    { x: 78, h: 6, dx: '0;0;8;-8;-48;-48' },
  ];
  const kt = '0;0.18;0.34;0.56;0.82;1';
  return (
    <svg viewBox="0 0 120 80">
      <path d="M36 12 L60 6 L84 12 M24 18 L36 12 M48 18 L36 12 M72 18 L84 12 M96 18 L84 12" stroke="currentColor" strokeOpacity={0.35} fill="none" strokeWidth={1.4} strokeLinecap="round" />
      <line x1={60} y1={24} x2={60} y2={70} stroke="#ff4d5e" strokeWidth={1.6} strokeDasharray="3 3" opacity={0}>
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={kt} dur="4.5s" repeatCount="indefinite" />
      </line>
      {bars.map((b, k) => (
        <rect key={k} x={b.x} y={70 - b.h} width={12} height={b.h} rx={2.5} fill="currentColor">
          <animateTransform attributeName="transform" type="translate" values={b.dx.split(';').map((d) => `${d} 0`).join(';')} keyTimes={kt} dur="4.5s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1" />
          <animate attributeName="fill" values="#a98bff;#a98bff;#6cb6ff;#6cb6ff;#5fd3a5;#5fd3a5" keyTimes={kt} dur="4.5s" repeatCount="indefinite" />
        </rect>
      ))}
      <line x1={20} y1={72} x2={100} y2={72} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
    </svg>
  );
}

// ---------------------------------------------------------------- definition

export default defineAlgorithm<Input, State>({
  id: 'merge-sort',
  name: 'Merge Sort',
  category: 'sorting',
  order: 5,
  tagline: 'Split in half, sort each half, merge the two sorted halves.',
  description:
    'A classic **divide & conquer** sort. Cutting the list in half repeatedly gives pieces of size one, which are sorted by definition. Two sorted lists can be **merged** into one in a single left-to-right pass by always taking the smaller front element. It always costs **O(n log n)** and is **stable**, at the price of an extra buffer.',
  howItWorks: [
    'If the range has 0 or 1 element, it is already sorted — return.',
    'Otherwise pick `mid` and recursively sort the left and right halves.',
    'Copy both sorted halves out into `L` and `R`.',
    'Repeatedly compare `L[i]` and `R[j]`, write the smaller into `a[k]`, advance.',
    'When one side runs out, copy the rest of the other side across.',
  ],
  complexity: { time: 'O(n log n)', space: 'O(n)', note: 'Same in best, average and worst case: log n levels, each merging n elements in total.' },
  code: {
    js: `
function mergeSort(a, lo = 0, hi = a.length - 1) { //@fn
  if (lo >= hi) return; //@base
  const mid = Math.floor((lo + hi) / 2); //@mid
  mergeSort(a, lo, mid); //@left
  mergeSort(a, mid + 1, hi); //@right
  merge(a, lo, mid, hi); //@merge
}

function merge(a, lo, mid, hi) {
  const L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1); //@copy
  let i = 0, j = 0, k = lo;
  while (i < L.length && j < R.length) { //@loop
    if (L[i] <= R[j]) { //@cmp
      a[k++] = L[i++]; //@takeL
    } else {
      a[k++] = R[j++]; //@takeR
    }
  }
  while (i < L.length) a[k++] = L[i++]; //@restL
  while (j < R.length) a[k++] = R[j++]; //@restR
}`,
    py: `
def merge_sort(a, lo=0, hi=None): #@fn
    if hi is None: hi = len(a) - 1
    if lo >= hi: return #@base
    mid = (lo + hi) // 2 #@mid
    merge_sort(a, lo, mid) #@left
    merge_sort(a, mid + 1, hi) #@right
    merge(a, lo, mid, hi) #@merge

def merge(a, lo, mid, hi):
    L, R = a[lo:mid + 1], a[mid + 1:hi + 1] #@copy
    i = j = 0; k = lo
    while i < len(L) and j < len(R): #@loop
        if L[i] <= R[j]: #@cmp
            a[k] = L[i]; i += 1 #@takeL
        else:
            a[k] = R[j]; j += 1 #@takeR
        k += 1
    while i < len(L): a[k] = L[i]; i += 1; k += 1 #@restL
    while j < len(R): a[k] = R[j]; j += 1; k += 1 #@restR`,
  },
  input: {
    default: [38, 27, 43, 3, 9, 82, 10, 55],
    presets: [
      { name: 'Classic 8', value: [38, 27, 43, 3, 9, 82, 10, 55] },
      { name: 'Odd length', value: [12, 5, 31, 8, 20, 1, 17] },
      { name: 'Already sorted', value: [2, 9, 14, 21, 33, 47, 58, 70] },
      { name: 'Reversed', value: [80, 64, 51, 42, 30, 19, 8, 3] },
      { name: 'Duplicates', value: [5, 3, 5, 1, 3, 5, 1, 3] },
      { name: 'Single element', value: [42] },
    ],
    random: () => randomArray(randInt(6, 10), 1, 99),
    format: formatNumberList,
    parse: (text) => parseSortList(text, { min: -99, max: 999, maxLen: 16 }),
    placeholder: '38, 27, 43, 3, 9, 82, 10',
    hint: 'Whole numbers from -99 to 999, separated by commas. 1–16 values.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current call' },
    { tone: 'frontier', label: 'waiting call' },
    { tone: 'compare', label: 'front elements compared' },
    { tone: 'swap', label: 'being written' },
    { tone: 'visited', label: 'sorted run' },
    { tone: 'done', label: 'final' },
  ],
  Glyph,
});
