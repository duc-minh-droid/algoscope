import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt } from '@/core/utils';
import { ArrayView, Callout, StatRow, Tag, VizSection, VizStack, toneFill, type Span } from '@/viz';

interface Input {
  arr: number[]; // always stored sorted
  target: number;
}

type Cmp = '=' | '≠' | '<' | '>';

interface Probe {
  lo: number;
  hi: number;
  mid: number;
  out?: Cmp; // '<' → went right, '>' → went left, '=' → found
}

interface State {
  arr: number[];
  lo: number;
  hi: number;
  mid: number; // -1 = not chosen yet
  showPtrs: boolean;
  midTone: Tone;
  cmp: Cmp | null;
  found: number;
  insert: number; // insertion point, only set on a miss
  done: boolean;
  probes: number;
  hist: Probe[];
}

const maxProbes = (n: number) => Math.floor(Math.log2(Math.max(1, n))) + 1;

function* run({ arr, target }: Input): Generator<Frame<State>> {
  const n = arr.length;
  let lo = 0;
  let hi = n - 1;
  let mid = -1;
  let probes = 0;
  const hist: Probe[] = [];
  const S = (o: Partial<State> = {}): State => ({
    arr: [...arr],
    lo,
    hi,
    mid,
    showPtrs: true,
    midTone: 'active',
    cmp: null,
    found: -1,
    insert: -1,
    done: false,
    probes,
    hist: hist.map((h) => ({ ...h })),
    ...o,
  });
  const V = () => ({ target, lo, hi, mid: mid < 0 ? undefined : mid, 'arr[mid]': mid < 0 ? undefined : arr[mid], window: Math.max(0, hi - lo + 1) });

  yield {
    state: S({ showPtrs: false }),
    line: 'fn',
    note: `Looking for **${target}** in **${n}** sorted values. Because the list is sorted, one comparison with the middle tells us which half the target **can't** be in.`,
    vars: { target, lo: undefined, hi: undefined, mid: undefined, 'arr[mid]': undefined, window: n },
    phase: 'setup',
  };
  yield {
    state: S(),
    line: 'init',
    note: `The search window starts as the whole list: **lo = 0**, **hi = ${n - 1}**. The answer, if it exists, is always inside [lo..hi].`,
    vars: V(),
    phase: 'setup',
  };

  while (true) {
    const size = hi - lo + 1;
    if (lo > hi) break;
    yield {
      state: S({ mid: -1 }),
      line: 'loop',
      note:
        probes === 0
          ? `lo ≤ hi, so the window [${lo}..${hi}] still holds **${size}** candidate${size > 1 ? 's' : ''}. At most **${maxProbes(n)}** probes will ever be needed for ${n} values.`
          : `Window [${lo}..${hi}] still has **${size}** candidate${size > 1 ? 's' : ''} (lo ≤ hi), so keep halving.`,
      vars: { ...V(), mid: undefined, 'arr[mid]': undefined },
      phase: `probe ${probes + 1}`,
    };
    mid = (lo + hi) >> 1;
    probes++;
    hist.push({ lo, hi, mid });
    yield {
      state: S(),
      line: 'mid',
      note: `Probe the middle: mid = ⌊(${lo} + ${hi}) / 2⌋ = **${mid}**, which holds **${arr[mid]}**.`,
      vars: V(),
      phase: `probe ${probes}`,
    };
    const v = arr[mid];
    if (v === target) {
      hist[hist.length - 1].out = '=';
      yield {
        state: S({ midTone: 'compare', cmp: '=' }),
        line: 'eq',
        note: `Is \`${v} === ${target}\`? **Yes!**`,
        vars: V(),
        phase: `probe ${probes}`,
      };
      yield {
        state: S({ midTone: 'found', cmp: '=', found: mid, done: true }),
        line: 'found',
        note: `Found **${target}** at index **${mid}** after only **${probes}** probe${probes > 1 ? 's' : ''} — a linear scan could have needed up to ${n}.`,
        vars: { ...V(), result: mid },
        phase: 'done',
      };
      return;
    }
    yield {
      state: S({ midTone: 'compare', cmp: '≠' }),
      line: 'eq',
      note: `Is \`${v} === ${target}\`? No — but the comparison still tells us which way to go.`,
      vars: V(),
      phase: `probe ${probes}`,
    };
    const goRight = v < target;
    yield {
      state: S({ midTone: 'compare', cmp: goRight ? '<' : '>' }),
      line: 'lt',
      note: goRight
        ? `\`${v} < ${target}\`: mid and **everything left of it** are too small (the list is sorted), so the target can only be on the **right**.`
        : `\`${v} > ${target}\`: mid and **everything right of it** are too big, so the target can only be on the **left**.`,
      vars: V(),
      phase: `probe ${probes}`,
    };
    hist[hist.length - 1].out = goRight ? '<' : '>';
    const before = size;
    if (goRight) lo = mid + 1;
    else hi = mid - 1;
    const after = Math.max(0, hi - lo + 1);
    yield {
      state: S({ midTone: 'muted', cmp: goRight ? '<' : '>' }),
      line: goRight ? 'right' : 'left',
      note: goRight
        ? `Move **lo** to mid + 1 = **${lo}**. The window shrinks from ${before} to **${after}** — ${before - after} value${before - after === 1 ? '' : 's'} discarded without ever looking at them.`
        : `Move **hi** to mid − 1 = **${hi}**. The window shrinks from ${before} to **${after}** — ${before - after} value${before - after === 1 ? '' : 's'} discarded without ever looking at them.`,
      vars: V(),
      phase: `probe ${probes}`,
    };
  }

  yield {
    state: S({ midTone: 'muted' }),
    line: 'loop',
    note: `Now lo (**${lo}**) > hi (**${hi}**): the window is **empty**, so ${target} is not in the list.`,
    vars: V(),
    phase: 'done',
  };
  const where = lo === 0 ? 'before every value' : lo === n ? 'after every value' : `between ${arr[lo - 1]} and ${arr[lo]}`;
  yield {
    state: S({ midTone: 'muted', insert: lo, done: true }),
    line: 'miss',
    note: `Return **-1** after ${probes} probe${probes === 1 ? '' : 's'}. Bonus: lo = **${lo}** is the insertion point — ${target} would slot in ${where} and keep the list sorted.`,
    vars: { ...V(), result: -1 },
    phase: 'done',
  };
}

/* ---------- halving funnel (hand-drawn) ---------- */

const PAD = 14;
const GAP = 8;

function rng(seed: number) {
  let s = (seed * 7919 + 17) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280 - 0.5;
  };
}

/** A slightly wobbly rounded rectangle outline, like a quick pencil sketch. */
function roughRect(x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed);
  const j = (a = 1.4) => (r() * a).toFixed(2);
  const o = Math.min(3, w / 6);
  return (
    `M${x + o} ${y + +j()} ` +
    `Q${x + w / 2} ${y - 1.2 + +j()} ${x + w - o} ${y + +j()} ` +
    `Q${x + w + 1} ${y + 1} ${x + w + +j()} ${y + h / 2} ` +
    `Q${x + w + 1} ${y + h - 1} ${x + w - o} ${y + h + +j()} ` +
    `Q${x + w / 2} ${y + h + 1.2 + +j()} ${x + o} ${y + h + +j()} ` +
    `Q${x - 1} ${y + h - 1} ${x + +j()} ${y + h / 2} ` +
    `Q${x - 1} ${y + 1} ${x + o + 2} ${y - 0.5}`
  );
}

function Funnel({ n, cell, hist, insert, found }: { n: number; cell: number; hist: Probe[]; insert: number; found: number }) {
  const stride = cell + GAP;
  const W = PAD * 2 + n * stride - GAP;
  const rowH = 26;
  const rows = maxProbes(n);
  const H = rows * rowH + 22;
  const xOf = (i: number) => PAD + i * stride;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: W * 1.5, margin: '0 auto', overflow: 'visible' }} aria-label="window halving">
      <style>{`
        .binary-search-row { animation: binary-search-in var(--step-ms) var(--ease-out); }
        .binary-search-draw { stroke-dasharray: 1; stroke-dashoffset: 0; animation: binary-search-draw calc(var(--step-ms) * 1.4) var(--ease-in-out); }
        @keyframes binary-search-in { from { opacity: 0; transform: translateY(-6px); } }
        @keyframes binary-search-draw { from { stroke-dashoffset: 1; } }
        .binary-search-ins { stroke-dasharray: 5 5; animation: binary-search-march 1s linear infinite; }
        @keyframes binary-search-march { to { stroke-dashoffset: -10; } }
        @media (prefers-reduced-motion: reduce) { .binary-search-row, .binary-search-draw, .binary-search-ins { animation: none; } }
      `}</style>
      {/* faint guide rails for every possible probe */}
      {Array.from({ length: rows }, (_, k) => (
        <line key={`g${k}`} x1={PAD} x2={W - PAD} y1={10 + k * rowH + 7} y2={10 + k * rowH + 7} stroke="var(--line)" strokeDasharray="2 6" />
      ))}
      {hist.map((h, k) => {
        const x0 = xOf(h.lo);
        const x1 = xOf(h.hi) + cell;
        const y = 10 + k * rowH;
        const size = h.hi - h.lo + 1;
        const last = k === hist.length - 1;
        const hit = h.out === '=';
        const stroke = hit ? toneFill('found') : last ? toneFill('frontier') : 'var(--paper-faint)';
        const cx = xOf(h.mid) + cell / 2;
        const labelRight = x1 + 30 < W;
        return (
          <g key={k} className="binary-search-row" opacity={last ? 1 : 0.75}>
            <path d={roughRect(x0 + 1, y, x1 - x0 - 2, 14, k + 1)} fill={stroke} fillOpacity={0.14} stroke={stroke} strokeWidth={1.6} pathLength={1} className={last ? 'binary-search-draw' : undefined} strokeLinecap="round" />
            {/* the discarded side of this probe gets a pencil strike */}
            {h.out === '<' && x0 < cx && <path d={`M${x0 + 4} ${y + 10} L${cx} ${y + 4}`} stroke="var(--coral)" strokeOpacity={0.6} strokeWidth={1.4} strokeLinecap="round" />}
            {h.out === '>' && cx < x1 && <path d={`M${cx} ${y + 10} L${x1 - 4} ${y + 4}`} stroke="var(--coral)" strokeOpacity={0.6} strokeWidth={1.4} strokeLinecap="round" />}
            <circle cx={cx} cy={y + 7} r={4.5} fill={hit ? toneFill('found') : toneFill('compare')} stroke="#0b0f18" strokeWidth={1.2} />
            <text
              x={labelRight ? x1 + 8 : x0 - 8}
              y={y + 11.5}
              textAnchor={labelRight ? 'start' : 'end'}
              style={{ font: '600 11px var(--font-mono)', fill: last ? 'var(--paper)' : 'var(--paper-dim)' }}
            >
              {size}
            </text>
          </g>
        );
      })}
      {insert >= 0 && (
        <g className="binary-search-row">
          <line className="binary-search-ins" x1={xOf(insert) - GAP / 2} x2={xOf(insert) - GAP / 2} y1={2} y2={H - 14} stroke={toneFill('path')} strokeWidth={2} />
          <text x={xOf(insert) - GAP / 2} y={H - 2} textAnchor="middle" style={{ font: '700 11px var(--font-mono)', fill: toneFill('path') }}>
            insert @ {insert}
          </text>
        </g>
      )}
      {found >= 0 && (
        <text x={xOf(found) + cell / 2} y={H - 2} textAnchor="middle" style={{ font: '700 11px var(--font-mono)', fill: toneFill('found') }}>
          ✓ index {found}
        </text>
      )}
    </svg>
  );
}

function View({ frame, input }: { frame: Frame<State>; input: Input }) {
  const { arr, lo, hi, mid, showPtrs, midTone, cmp, found, insert, done, probes, hist } = frame.state;
  const n = arr.length;
  const cell = n <= 10 ? 54 : n <= 14 ? 46 : 38;
  const empty = lo > hi;
  const tone = (k: number): Tone | undefined => {
    if (k === found) return 'found';
    if (k === mid && midTone !== 'muted') return midTone;
    if (empty || k < lo || k > hi) return 'muted';
    return undefined;
  };
  const size = Math.max(0, hi - lo + 1);
  const span: Span = empty
    ? { from: Math.max(0, Math.min(hi, n - 1)), to: Math.min(n - 1, Math.max(lo, 0)), label: 'lo > hi · empty', tone: 'danger', side: 'top' }
    : { from: lo, to: hi, label: showPtrs ? `window · ${size}` : `sorted · ${n} values`, tone: found >= 0 ? 'found' : 'frontier', side: 'top' };
  const sizes = hist.map((h) => h.hi - h.lo + 1);
  if (!done && hist.length && hist[hist.length - 1].out && hist[hist.length - 1].out !== '=') sizes.push(size);
  if (insert >= 0) sizes.push(0);
  const chain = sizes.length ? sizes.join(' → ') : String(n);
  const v = mid >= 0 ? arr[mid] : undefined;
  const verdict =
    cmp === '=' ? 'match!' : cmp === '<' ? 'target is to the right →' : cmp === '>' ? '← target is to the left' : cmp === '≠' ? 'not equal…' : '';
  const opText = cmp === '<' ? '<' : cmp === '>' ? '>' : cmp === '=' ? '=' : cmp === '≠' ? '≠' : '?';

  return (
    <VizStack gap={18}>
      <StatRow
        stats={[
          { label: 'probes', value: probes, tone: 'compare' },
          { label: 'window size', value: size, tone: empty ? 'danger' : 'frontier' },
          { label: `max probes (⌊log₂${n}⌋+1)`, value: maxProbes(n) },
          { label: 'linear search worst', value: n },
        ]}
      />
      <ArrayView
        items={arr}
        tones={tone}
        cell={cell}
        spans={[span]}
        pointers={[
          { index: showPtrs && lo < n ? lo : -1, label: 'lo', tone: 'visited' },
          { index: showPtrs && hi >= 0 ? hi : -1, label: 'hi', tone: 'visited' },
          { index: mid, label: 'mid', tone: found >= 0 ? 'found' : 'compare', side: 'bottom' },
        ]}
      />
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          minHeight: 28,
          opacity: cmp ? 1 : 0.35,
          transition: 'opacity var(--step-ms) ease',
        }}
      >
        <Tag tone={cmp ? 'compare' : 'idle'}>arr[mid] = {v ?? '·'}</Tag>
        <span style={{ fontSize: 20, color: 'var(--paper)', minWidth: 18, textAlign: 'center' }}>{opText}</span>
        <Tag tone="path">target = {input.target}</Tag>
        <span style={{ color: 'var(--paper-dim)', minWidth: 190 }}>{verdict}</span>
      </div>
      <VizSection label="halving" aside={<span style={{ fontFamily: 'var(--font-mono)' }}>{chain}</span>}>
        <Funnel n={n} cell={cell} hist={hist} insert={insert} found={found} />
      </VizSection>
      <Callout show={done} tone={found >= 0 ? 'found' : 'danger'}>
        {found >= 0 ? `return ${found}` : `return -1 · insert at ${insert}`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const kt = '0;0.22;0.3;0.52;0.6;0.82;1';
  return (
    <svg viewBox="0 0 120 80">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
        <rect key={k} x={6 + k * 14} y={30} width={11} height={16} rx={3} fill="currentColor" fillOpacity={0.35 + k * 0.06} />
      ))}
      {/* the search window bracket */}
      <rect y={25} height={26} rx={5} fill="none" stroke="currentColor" strokeWidth={2}>
        <animate attributeName="x" values="3;3;59;59;87;87;3" keyTimes={kt} dur="4s" repeatCount="indefinite" />
        <animate attributeName="width" values="114;114;58;58;30;30;114" keyTimes={kt} dur="4s" repeatCount="indefinite" />
        <animate attributeName="stroke" values="#a98bff;#a98bff;#a98bff;#a98bff;#c6f36b;#c6f36b;#a98bff" keyTimes={kt} dur="4s" repeatCount="indefinite" />
      </rect>
      {/* mid probe */}
      <path d="M0 62 l-5 7 h10 z" fill="#ff6b5b">
        <animateTransform attributeName="transform" type="translate" values="54 0;54 0;82 0;82 0;96 0;96 0;54 0" keyTimes={kt} dur="4s" repeatCount="indefinite" />
      </path>
      {/* halving ladder */}
      <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.7}>
        <line x1={8} x2={52} y1={12} y2={12} />
        <line x1={30} x2={52} y1={18} y2={18}>
          <animate attributeName="opacity" values="0;0;1;1;1;1;0" keyTimes={kt} dur="4s" repeatCount="indefinite" />
        </line>
        <line x1={41} x2={52} y1={24} y2={24}>
          <animate attributeName="opacity" values="0;0;0;0;1;1;0" keyTimes={kt} dur="4s" repeatCount="indefinite" />
        </line>
      </g>
      <text x={60} y={18} fontSize={9} fontFamily="monospace" fill="currentColor" opacity={0.8}>
        n → n/2 → …
      </text>
    </svg>
  );
}

const parse = (text: string): Input => {
  const [a, t, extra] = text.split('|');
  if (t === undefined) throw new Error('Add the target after a "|", e.g. "4, 8, 15, 16 | 15".');
  if (extra !== undefined) throw new Error('Use only one "|" — numbers on the left, the target on the right.');
  const arr = parseNumberList(a, { minLen: 1, maxLen: 20 }).sort((x, y) => x - y);
  if (!t.trim()) throw new Error('The target after "|" is missing.');
  const [target] = parseNumberList(t, { minLen: 1, maxLen: 1 });
  return { arr, target };
};

export default defineAlgorithm<Input, State>({
  id: 'binary-search',
  name: 'Binary Search',
  category: 'searching',
  order: 2,
  tagline: 'Halve a sorted list with every comparison until only the answer is left.',
  description:
    'On a **sorted** list, comparing the target with the **middle** element rules out half of the remaining values at once. Repeating that halving means even a million values need only about **20** comparisons. If the target is missing, the final `lo` is exactly where it would be inserted.',
  howItWorks: [
    'Keep a window `[lo..hi]` that must contain the target if it exists — start with the whole list.',
    'Look at the middle element `mid`.',
    'Equal? Done. Too small? Throw away the left half (`lo = mid + 1`). Too big? Throw away the right half (`hi = mid - 1`).',
    'When `lo > hi` the window is empty: return `-1` (and `lo` is the insertion point).',
  ],
  complexity: { time: 'O(log n)', space: 'O(1)', note: 'At most ⌊log₂ n⌋ + 1 probes; best case O(1) when the middle is the target. Requires sorted input.' },
  code: {
    js: `
function binarySearch(arr, target) { //@fn
  let lo = 0, hi = arr.length - 1; //@init
  while (lo <= hi) { //@loop
    const mid = Math.floor((lo + hi) / 2); //@mid
    if (arr[mid] === target) { //@eq
      return mid; //@found
    } else if (arr[mid] < target) { //@lt
      lo = mid + 1; //@right
    } else {
      hi = mid - 1; //@left
    }
  }
  return -1; // lo is the insertion point //@miss
}`,
    py: `
def binary_search(arr, target): #@fn
    lo, hi = 0, len(arr) - 1 #@init
    while lo <= hi: #@loop
        mid = (lo + hi) // 2 #@mid
        if arr[mid] == target: #@eq
            return mid #@found
        elif arr[mid] < target: #@lt
            lo = mid + 1 #@right
        else:
            hi = mid - 1 #@left
    return -1  # lo is the insertion point #@miss`,
  },
  input: {
    default: { arr: [2, 5, 8, 12, 16, 21, 25, 30, 34, 39, 43, 47, 52, 58, 63, 67, 72, 78, 83, 91], target: 58 },
    presets: [
      { name: 'Found after 5 probes', value: { arr: [2, 5, 8, 12, 16, 21, 25, 30, 34, 39, 43, 47, 52, 58, 63, 67, 72, 78, 83, 91], target: 58 } },
      { name: 'Missing → insertion point', value: { arr: [2, 5, 9, 14, 20, 27, 35, 44, 54, 65], target: 30 } },
      { name: 'Middle on first try', value: { arr: [10, 20, 30, 40, 50, 60, 70], target: 40 } },
      { name: 'Smaller than everything', value: { arr: [12, 18, 25, 31, 47], target: 4 } },
      { name: 'Single element', value: { arr: [8], target: 8 } },
    ],
    random: () => {
      const n = randInt(7, 16);
      const set = new Set<number>();
      while (set.size < n) set.add(randInt(1, 99));
      const arr = [...set].sort((a, b) => a - b);
      const target = Math.random() < 0.7 ? arr[randInt(0, n - 1)] : randInt(0, 100);
      return { arr, target };
    },
    format: (v) => `${formatNumberList(v.arr)} | ${v.target}`,
    parse,
    placeholder: '4, 8, 15, 16, 23, 42 | 16',
    hint: 'Numbers, then "|" and the target. Up to 20 values — unsorted input is sorted for you (binary search needs it).',
  },
  run,
  View,
  legend: [
    { tone: 'frontier', label: 'search window' },
    { tone: 'active', label: 'mid chosen' },
    { tone: 'compare', label: 'comparing' },
    { tone: 'muted', label: 'discarded half' },
    { tone: 'found', label: 'match' },
    { tone: 'path', label: 'insertion point' },
  ],
  Glyph,
});
