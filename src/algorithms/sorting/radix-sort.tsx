import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, randInt, randomArray } from '@/core/utils';
import { Callout, StatRow, VizStack, toneFill } from '@/viz';
import { Caret, Glide, SortBStyle, TileBody, listText, parseSortList, sketchBin } from './_sortB';

type Input = number[];

interface RTile {
  id: number;
  value: number;
  where: 'arr' | 'bin';
  idx: number; // array index, or bucket number when in a bin
  slot: number; // height in the bin (0 = bottom)
  tone?: Tone;
}

interface State {
  tiles: RTile[];
  D: number; // number of digit passes
  pass: number; // current pass (0 = ones), -1 before start
  settled: number; // digits the array is already sorted by
  cursor: number; // array index being read (-1 hidden)
  bin: number; // bucket being filled / emptied (-1 none)
  reads: number;
  moves: number;
  finished: boolean;
}

const PASS_NAMES = ['ones', 'tens', 'hundreds'];
const digitOf = (v: number, p: number) => Math.floor(v / 10 ** p) % 10;
const digitsIn = (max: number) => (max <= 0 ? 0 : String(max).length);

function* run(arr: Input): Generator<Frame<State>> {
  const n = arr.length;
  const tiles: RTile[] = arr.map((value, id) => ({ id, value, where: 'arr', idx: id, slot: 0 }));
  const max = Math.max(...arr);
  const D = digitsIn(max);
  let reads = 0;
  let moves = 0;
  const st = { pass: -1, settled: 0, cursor: -1, bin: -1 };
  const S = (finished = false): State => ({ tiles: tiles.map((t) => ({ ...t })), D, ...st, reads, moves, finished });
  const inArr = () =>
    tiles
      .filter((t) => t.where === 'arr')
      .sort((a, b) => a.idx - b.idx)
      .map((t) => t.value);
  const sizes = () => Array.from({ length: 10 }, (_, b) => tiles.filter((t) => t.where === 'bin' && t.idx === b).length);
  const V = (o: { x?: number; digit?: number; k?: number } = {}) => ({
    exp: st.pass < 0 ? undefined : 10 ** st.pass,
    x: o.x,
    digit: o.digit,
    k: o.k,
    buckets: sizes(),
  });

  yield {
    state: S(),
    line: ['fn', 'max'],
    note:
      D === 0
        ? `Radix sort never compares two numbers — it sorts by **digits**. The max is **0**, so there are no digits to process: the array is already sorted.`
        : `Radix sort never compares two numbers — it sorts by **digits**, least significant first. max = **${max}** has **${D}** digit${D > 1 ? 's' : ''}, so we need ${D} pass${D > 1 ? 'es' : ''} (${PASS_NAMES.slice(0, D).join(', ')}).`,
    vars: V(),
    phase: D ? 'ones' : 'done',
  };

  for (let p = 0; p < D; p++) {
    const exp = 10 ** p;
    const phase = PASS_NAMES[p];
    Object.assign(st, { pass: p, cursor: -1, bin: -1 });
    tiles.forEach((t) => (t.tone = undefined));
    yield {
      state: S(),
      line: ['pass', 'buckets'],
      note: `Pass ${p + 1}: look only at the **${phase}** digit (highlighted in every number) and set up 10 empty buckets, one per digit 0–9.${p > 0 ? ` The array is already sorted by the last ${p} digit${p > 1 ? 's' : ''}.` : ''}`,
      vars: V(),
      phase,
    };
    // distribute
    const order = tiles.filter((t) => t.where === 'arr').sort((a, b) => a.idx - b.idx);
    const fill = Array(10).fill(0);
    for (let k = 0; k < n; k++) {
      const t = order[k];
      const d = digitOf(t.value, p);
      const behind = fill[d];
      t.where = 'bin';
      t.idx = d;
      t.slot = fill[d]++;
      t.tone = 'swap';
      reads++;
      moves++;
      Object.assign(st, { cursor: k, bin: d });
      yield {
        state: S(),
        line: ['scan', 'digit', 'drop'],
        note: `a[${k}] = **${t.value}**: ⌊${t.value} / ${exp}⌋ mod 10 = **${d}**, so it drops into bucket **${d}**${behind ? ` on top of ${behind} earlier arrival${behind > 1 ? 's' : ''}` : ''}.`,
        vars: V({ x: t.value, digit: d, k }),
        phase,
      };
      t.tone = 'frontier';
    }
    // collect
    let k = 0;
    let firstOfPass = true;
    for (let b = 0; b < 10; b++) {
      const inBin = tiles.filter((t) => t.where === 'bin' && t.idx === b).sort((x, y) => x.slot - y.slot);
      for (let q = 0; q < inBin.length; q++) {
        const t = inBin[q];
        t.where = 'arr';
        t.idx = k;
        t.slot = 0;
        t.tone = 'swap';
        moves++;
        tiles.filter((o) => o.where === 'bin' && o.idx === b).forEach((o) => o.slot--);
        Object.assign(st, { cursor: k, bin: b });
        const tags = q === 0 ? (firstOfPass ? ['collect', 'bucket', 'write'] : ['bucket', 'write']) : ['write'];
        const note =
          q === 0
            ? `${firstOfPass ? 'All numbers are in buckets. Now collect them back, bucket 0 first. ' : ''}Bucket **${b}**: its oldest item **${t.value}** goes to a[${k}].${inBin.length > 1 ? ' Buckets are queues — first in, first out.' : ''}`
            : `Next out of bucket ${b}: **${t.value}** → a[${k}]. Keeping arrival order is what makes each pass **stable**, so earlier passes aren't undone.`;
        yield { state: S(), line: tags, note, vars: V({ x: t.value, digit: b, k }), phase };
        t.tone = 'visited';
        firstOfPass = false;
        k++;
      }
    }
    Object.assign(st, { settled: p + 1, cursor: -1, bin: -1 });
    yield {
      state: S(),
      line: 'pass',
      note:
        p + 1 < D
          ? `End of the ${phase} pass: **${listText(inArr())}** is now sorted by its last ${p + 1} digit${p ? 's' : ''} (green). Next, the ${PASS_NAMES[p + 1]} digit.`
          : `End of the ${phase} pass — every digit has been processed, most significant last, so the array is fully sorted.`,
      vars: V(),
      phase,
    };
  }

  tiles.forEach((t) => (t.tone = 'done'));
  Object.assign(st, { cursor: -1, bin: -1, settled: D });
  yield {
    state: S(true),
    line: 'done',
    note: `Sorted with **0 comparisons**: ${D} pass${D === 1 ? '' : 'es'} × ${n} numbers = **${reads}** digit reads and **${moves}** moves. Time is O(d·(n + 10)) — linear in n for a fixed number of digits.`,
    vars: V(),
    phase: 'done',
  };
}

// ---------------------------------------------------------------- View

const TW = 46; // tile width
const THH = 30; // tile height
const STRIDE = 52; // array stride
const BS = 62; // bin stride
const BW = 54; // bin inner width
const SLOT = 33; // stacking stride inside a bin

function Digits({ value, D, pass, settled, finished, cx, cy }: { value: number; D: number; pass: number; settled: number; finished: boolean; cx: number; cy: number }) {
  const width = Math.max(D, 1);
  const s = String(value).padStart(width, '0');
  const lead = width - String(value).length;
  return (
    <text className="sortb-val" x={cx} y={cy} fontSize={15}>
      {s.split('').map((ch, q) => {
        const p = width - 1 - q; // digit position (0 = ones)
        const cur = !finished && p === pass;
        const good = !finished && p < settled && !cur;
        const fill = finished ? '#0b0f18' : cur ? toneFill('active') : good ? toneFill('done') : 'var(--paper)';
        const ghost = q < lead && !cur;
        return (
          <tspan key={q} style={{ fill, opacity: ghost ? 0.28 : 1, fontWeight: cur ? 800 : 600 }} textDecoration={cur ? 'underline' : undefined}>
            {ch}
          </tspan>
        );
      })}
    </text>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const n = s.tiles.length;
  const values = s.tiles.map((t) => t.value);
  const maxBucket = Math.max(
    3,
    ...Array.from({ length: Math.max(1, s.D) }, (_, p) => {
      const c = Array(10).fill(0);
      values.forEach((v) => c[digitOf(v, p)]++);
      return Math.max(...c);
    }),
  );
  const rowW = n * STRIDE - (STRIDE - TW);
  const binsW = 10 * BS - (BS - BW);
  const W = Math.max(rowW, binsW) + 40;
  const ax = (W - rowW) / 2;
  const bx = (W - binsW) / 2;
  const arrY = 34;
  const binTop = arrY + THH + 70;
  const binH = maxBucket * SLOT + 10;
  const H = binTop + binH + 34;
  const binX = (b: number) => bx + b * BS;
  const counts = Array.from({ length: 10 }, (_, b) => s.tiles.filter((t) => t.where === 'bin' && t.idx === b).length);
  const passName = s.pass >= 0 ? PASS_NAMES[s.pass] : '—';

  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'pass', value: s.D === 0 ? '—' : `${Math.max(0, s.pass) + (s.pass >= 0 ? 1 : 0)} / ${s.D}` },
          { label: 'digit', value: s.finished ? 'all' : passName, tone: 'active' },
          { label: 'comparisons', value: 0 },
          { label: 'digit reads', value: s.reads },
          { label: 'moves', value: s.moves, tone: 'swap' },
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.35, margin: '0 auto', display: 'block', overflow: 'visible' }} role="img" aria-label="radix sort buckets">
        <SortBStyle roughId="rsort-rough" />
        {/* array slots */}
        {Array.from({ length: n }, (_, k) => (
          <g key={`s${k}`}>
            <rect x={ax + k * STRIDE} y={arrY} width={TW} height={THH} rx={8} fill="none" stroke="var(--line-strong)" strokeDasharray="4 4" />
            <text className="sortb-small" x={ax + k * STRIDE + TW / 2} y={arrY + THH + 15}>
              {k}
            </text>
          </g>
        ))}
        {/* bins */}
        {Array.from({ length: 10 }, (_, b) => {
          const active = s.bin === b && !s.finished;
          const used = counts[b] > 0;
          return (
            <g key={`b${b}`}>
              <rect
                className="sortb-paint"
                x={binX(b)}
                y={binTop}
                width={BW}
                height={binH}
                rx={9}
                style={{ fill: toneFill('active'), fillOpacity: active ? 0.12 : 0 }}
              />
              <path
                className="sortb-paint"
                d={sketchBin(binX(b), binTop, BW, binH, b * 17 + 5)}
                fill="none"
                strokeWidth={active ? 2.4 : 1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#rsort-rough)"
                style={{ stroke: active ? toneFill('active') : used ? 'rgba(236,230,214,0.55)' : 'rgba(236,230,214,0.28)' }}
              />
              <text
                className="sortb-hand sortb-paint"
                x={binX(b) + BW / 2}
                y={binTop + binH + 24}
                fontSize={22}
                style={{ fill: active ? toneFill('active') : 'var(--paper-dim)' }}
              >
                {b}
              </text>
            </g>
          );
        })}
        <text className="sortb-hand sortb-fade" x={W / 2} y={binTop - 14} fontSize={15} style={{ fill: 'var(--paper-faint)', opacity: s.pass >= 0 && !s.finished ? 1 : 0 }}>
          buckets by {passName} digit
        </text>
        {/* tiles */}
        {s.tiles.map((t) => {
          const x = t.where === 'arr' ? ax + t.idx * STRIDE : binX(t.idx) + (BW - TW) / 2;
          const y = t.where === 'arr' ? arrY : binTop + binH - 5 - (t.slot + 1) * SLOT + (SLOT - THH);
          const tone = t.tone === 'done' ? 'done' : undefined;
          return (
            <Glide key={t.id} x={x} y={y}>
              <TileBody w={TW} h={THH} tone={tone} rx={7}>
                {t.tone && t.tone !== 'done' && (
                  <rect className="sortb-paint" width={TW} height={THH} rx={7} fill="none" strokeWidth={2} style={{ stroke: toneFill(t.tone) }} />
                )}
                <Digits value={t.value} D={s.D} pass={s.pass} settled={s.settled} finished={s.finished} cx={TW / 2} cy={THH / 2 + 5.5} />
              </TileBody>
            </Glide>
          );
        })}
        <Caret x={ax + Math.max(0, s.cursor) * STRIDE + TW / 2} y={arrY - 4} label="k" tone="active" hidden={s.cursor < 0} />
      </svg>
      <Callout show={s.finished} tone="done">
        sorted: {s.tiles.slice().sort((a, b) => a.idx - b.idx).map((t) => t.value).join(' · ')}
      </Callout>
    </VizStack>
  );
}

// ---------------------------------------------------------------- Glyph

function Glyph() {
  const tiles = [
    { label: '31', x: 18, to: 16, bin: 0 },
    { label: '12', x: 50, to: 52, bin: 1 },
    { label: '23', x: 82, to: 88, bin: 2 },
  ];
  return (
    <svg viewBox="0 0 120 80">
      {[0, 1, 2].map((b) => (
        <g key={b}>
          <path d={`M${12 + b * 36} 44 L${14 + b * 36} 70 Q${14 + b * 36} 74 ${18 + b * 36} 74 L${38 + b * 36} 74 Q${42 + b * 36} 74 ${42 + b * 36} 70 L${44 + b * 36} 44`} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.6} strokeLinecap="round" />
          <text x={28 + b * 36} y={80} fontSize={7} fill="currentColor" textAnchor="middle" fontFamily="monospace" opacity={0.7}>
            {b + 1}
          </text>
        </g>
      ))}
      {tiles.map((t, k) => (
        <g key={k}>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 0;0 0;${t.to - t.x} 44;${t.to - t.x} 44;0 0`}
            keyTimes={`0;${0.1 + k * 0.12};${0.28 + k * 0.12};0.8;1`}
            dur="4s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0 0 1 1;0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1"
          />
          <rect x={t.x} y={8} width={24} height={16} rx={4} fill="#1b2539" stroke="currentColor" strokeWidth={1.2} />
          <text x={t.x + 8} y={20} fontSize={10} fill="currentColor" textAnchor="middle" fontFamily="monospace">
            {t.label[0]}
          </text>
          <text x={t.x + 16} y={20} fontSize={10} fill="#f5b544" textAnchor="middle" fontFamily="monospace" fontWeight="bold">
            {t.label[1]}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- definition

export default defineAlgorithm<Input, State>({
  id: 'radix-sort',
  name: 'Radix Sort (LSD)',
  category: 'sorting',
  order: 7,
  tagline: 'Sort by one digit at a time — ones, then tens, then hundreds.',
  description:
    'Radix sort never compares two numbers. It distributes them into **10 buckets** by one digit, then collects the buckets in order. Starting from the **least significant** digit and keeping each pass **stable** (buckets are first-in, first-out), after the last pass the numbers are fully sorted.',
  howItWorks: [
    'Find the maximum to know how many digits (passes) are needed.',
    'For each digit position, drop every number into bucket `⌊x / exp⌋ % 10`.',
    'Collect buckets 0 → 9, each in arrival order, back into the array.',
    'Stability means ties on this digit keep the order from earlier passes.',
    'After the most significant digit, the array is sorted.',
  ],
  complexity: { time: 'O(d · (n + b))', space: 'O(n + b)', note: 'd = number of digits, b = 10 buckets. No comparisons, so it beats the O(n log n) comparison-sort bound for small d.' },
  code: {
    js: `
function radixSort(a) { //@fn
  const max = Math.max(...a); //@max
  for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) { //@pass
    const buckets = Array.from({ length: 10 }, () => []); //@buckets
    for (const x of a) { //@scan
      const d = Math.floor(x / exp) % 10; //@digit
      buckets[d].push(x); //@drop
    }
    let k = 0; //@collect
    for (const bucket of buckets) { //@bucket
      for (const x of bucket) a[k++] = x; //@write
    }
  }
  return a; //@done
}`,
    py: `
def radix_sort(a): #@fn
    m = max(a) #@max
    exp = 1
    while m // exp > 0: #@pass
        buckets = [[] for _ in range(10)] #@buckets
        for x in a: #@scan
            d = (x // exp) % 10 #@digit
            buckets[d].append(x) #@drop
        k = 0 #@collect
        for bucket in buckets: #@bucket
            for x in bucket: a[k] = x; k += 1 #@write
        exp *= 10
    return a #@done`,
  },
  input: {
    default: [170, 45, 75, 90, 802, 24, 2, 66, 318, 511],
    presets: [
      { name: 'Classic', value: [170, 45, 75, 90, 802, 24, 2, 66, 318, 511] },
      { name: 'Mixed widths', value: [9, 900, 90, 99, 909, 0, 409] },
      { name: 'Already sorted', value: [3, 14, 27, 58, 109, 263, 401, 999] },
      { name: 'Reversed', value: [870, 640, 512, 333, 210, 97, 45, 8] },
      { name: 'Duplicates', value: [42, 7, 42, 301, 7, 42, 130, 7] },
      { name: 'Single element', value: [5] },
    ],
    random: () => randomArray(randInt(6, 10), 0, 999),
    format: formatNumberList,
    parse: (text) => {
      if (/(^|[\s,;])-\d/.test(text)) throw new Error('Radix sort here works on non-negative numbers only (0–999).');
      return parseSortList(text, { min: 0, max: 999, maxLen: 16 });
    },
    placeholder: '170, 45, 75, 90, 802, 24, 2, 66',
    hint: 'Whole numbers from 0 to 999 (up to 3 digits), separated by commas. 1–16 values.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current digit / bucket' },
    { tone: 'swap', label: 'moving' },
    { tone: 'frontier', label: 'waiting in bucket' },
    { tone: 'visited', label: 'collected this pass' },
    { tone: 'done', label: 'sorted digits / final' },
  ],
  Glyph,
});
