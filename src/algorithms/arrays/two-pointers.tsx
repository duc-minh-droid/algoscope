import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt, randomArray } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizSection, VizStack, toneFill, toneInk } from '@/viz';
import { sketchLine } from './_arraysB';

interface Input {
  arr: number[]; // positive
  target: number;
}

type Mode = 'setup' | 'add' | 'record' | 'shrink' | 'done';

interface State {
  arr: number[];
  L: number;
  R: number; // -1 before the first expansion
  sum: number;
  best: number; // Infinity until a valid window is seen
  bestL: number;
  bestR: number;
  joining: number; // index that just entered (-1)
  leaving: number; // index that just left (-1)
  improved: boolean;
  mode: Mode;
  moves: number; // total pointer moves
  scaleMax: number;
  result: number | null;
}

const CELL = 50;

function* run({ arr, target }: Input): Generator<Frame<State>> {
  const n = arr.length;
  // dry run for a fixed gauge scale
  let peak = 0;
  {
    let s = 0;
    let l = 0;
    for (let r = 0; r < n; r++) {
      s += arr[r];
      peak = Math.max(peak, s);
      while (s >= target) s -= arr[l++];
    }
  }
  const scaleMax = Math.max(target, peak) * 1.1;
  let L = 0;
  let sum = 0;
  let best = Infinity;
  let bestL = -1;
  let bestR = -1;
  let moves = 0;
  const snap = (R: number, o: Partial<State>): State => ({
    arr: [...arr],
    L,
    R,
    sum,
    best,
    bestL,
    bestR,
    joining: -1,
    leaving: -1,
    improved: false,
    mode: 'add',
    moves,
    scaleMax,
    result: null,
    ...o,
  });
  const vars = (R: number | undefined) => ({ target, L, R, sum, best: best === Infinity ? '∞' : best, 'R-L+1': R === undefined ? 0 : Math.max(0, R - L + 1) });

  yield {
    state: snap(-1, { mode: 'setup' }),
    line: ['fn', 'init'],
    note: `Find the **shortest** stretch of consecutive numbers whose sum is **≥ ${target}**. Two pointers mark a window [L..R]: **R grows** it until the sum is big enough, then **L shrinks** it to see how short it can get.`,
    vars: vars(undefined),
    phase: 'expand',
  };

  for (let R = 0; R < n; R++) {
    sum += arr[R];
    moves++;
    const short = sum < target;
    yield {
      state: snap(R, { joining: R }),
      line: short ? ['expand', 'add', 'check'] : ['expand', 'add'],
      note: short
        ? `R steps to **${R}**: **${arr[R]}** joins the window, sum = **${sum}**. Still ${target - sum} short of ${target}, so keep expanding.`
        : `R steps to **${R}**: **${arr[R]}** joins, sum = **${sum}** — that reaches ${target}!`,
      vars: vars(R),
      phase: 'expand',
    };
    while (sum >= target) {
      const len = R - L + 1;
      const improved = len < best;
      const prevBest = best;
      if (improved) {
        best = len;
        bestL = L;
        bestR = R;
      }
      yield {
        state: snap(R, { mode: 'record', improved }),
        line: ['check', 'record'],
        note: improved
          ? `sum ${sum} ≥ ${target}, so [${L}..${R}] is valid with length **${len}**${prevBest === Infinity ? ' — our first valid window' : `, shorter than ${prevBest}`}. **New best!**`
          : `sum ${sum} ≥ ${target} is valid, but length ${len} isn't shorter than the best **${best}**. Keep it in mind and shrink anyway.`,
        vars: vars(R),
        phase: 'shrink',
      };
      const out = arr[L];
      sum -= out;
      const leaving = L;
      L++;
      moves++;
      yield {
        state: snap(R, { mode: 'shrink', leaving }),
        line: 'shrink',
        note:
          sum >= target
            ? `Squeeze from the left: **${out}** leaves, sum = **${sum}**. Still ≥ ${target}, so an even shorter window might work.`
            : `Squeeze from the left: **${out}** leaves, sum = **${sum}** < ${target}. Too small now — every window ending at R and starting further right is smaller still, so move R on.`,
        vars: vars(R),
        phase: 'shrink',
      };
    }
  }

  const ok = best !== Infinity;
  yield {
    state: snap(n - 1, { mode: 'done', result: ok ? best : 0 }),
    line: 'result',
    note: ok
      ? `R has reached the end. The shortest window with sum ≥ ${target} is **[${arr.slice(bestL, bestR + 1).join(', ')}]**, length **${best}**. Each pointer only moved forward: **${moves}** moves in total instead of checking all ${(n * (n + 1)) / 2} subarrays.`
      : `R has reached the end and the sum never hit ${target} — even the whole array sums to less. Return **0**.`,
    vars: vars(n - 1),
    phase: 'done',
  };
}

/** Window sum gauge: each element in the window is a segment; the bar slides as elements join/leave. */
function Gauge({ s, target }: { s: State; target: number }) {
  const W = 560;
  const H = 104;
  const x0 = 18;
  const bw = W - 36;
  const k = bw / s.scaleMax;
  const reached = s.sum >= target;
  const segs: { i: number; x: number; w: number }[] = [];
  let acc = 0;
  if (s.R >= 0)
    for (let i = s.L; i <= s.R; i++) {
      segs.push({ i, x: acc * k, w: s.arr[i] * k });
      acc += s.arr[i];
    }
  const tx = x0 + target * k;
  const fillEnd = x0 + s.sum * k;
  const segTone = (i: number): Tone => (s.mode === 'done' ? (i >= s.bestL && i <= s.bestR ? 'found' : 'visited') : i === s.joining ? 'active' : reached ? 'done' : 'visited');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: W * 1.3, margin: '0 auto', overflow: 'visible' }} aria-label={`window sum ${s.sum} of target ${target}`}>
      <style>{`
        .two-pointers-seg { transition: transform var(--step-ms) var(--ease-in-out); }
        .two-pointers-seg rect { transition: fill var(--step-ms) ease; }
        .two-pointers-in { animation: two-pointers-in var(--step-ms) var(--ease-out); }
        .two-pointers-out { animation: two-pointers-out calc(var(--step-ms) * 1.2) var(--ease-out) forwards; }
        .two-pointers-label { transition: transform var(--step-ms) var(--ease-in-out); }
        @keyframes two-pointers-in { from { opacity: 0; transform: translateX(14px); } }
        @keyframes two-pointers-out { to { opacity: 0; transform: translate(-18px, 16px) rotate(-6deg); } }
        @media (prefers-reduced-motion: reduce) {
          .two-pointers-seg, .two-pointers-label { transition: none; }
          .two-pointers-in { animation: none; }
          .two-pointers-out { animation-duration: 1ms; }
        }
      `}</style>
      <rect x={x0} y={36} width={bw} height={30} rx={9} fill="var(--ink-3)" stroke="var(--line-strong)" />
      {s.leaving >= 0 && (
        <g key={`out-${s.leaving}`} transform={`translate(${x0} 38)`}>
          <g className="two-pointers-out">
            <rect width={Math.max(2, s.arr[s.leaving] * k - 2)} height={26} rx={6} fill={toneFill('muted')} stroke="var(--paper-faint)" strokeDasharray="3 3" />
          </g>
        </g>
      )}
      {segs.map((g) => (
        <g key={g.i} className="two-pointers-seg" style={{ transform: `translate(${x0 + g.x}px, 38px)` }}>
          <g className={g.i === s.joining ? 'two-pointers-in' : undefined}>
            <rect width={Math.max(2, g.w - 2)} height={26} rx={6} fill={toneFill(segTone(g.i))} />
            {g.w > 20 && (
              <text x={(g.w - 2) / 2} y={17.5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11.5} fontWeight={700} fill={toneInk(segTone(g.i))}>
                {s.arr[g.i]}
              </text>
            )}
          </g>
        </g>
      ))}
      {/* target line, hand-drawn */}
      <path d={sketchLine(tx, 24, tx, 78, target, 1.2)} stroke={toneFill('path')} strokeWidth={2.2} strokeDasharray="6 4" fill="none" />
      <text x={tx} y={94} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11.5} fontWeight={700} fill={toneFill('path')}>
        target {target}
      </text>
      {/* live sum label rides the end of the fill */}
      <g className="two-pointers-label" style={{ transform: `translate(${fillEnd}px, 0px)` }}>
        <path d="M0 28 l-5 -7 h10 z" fill={reached ? toneFill('found') : toneFill('active')} />
        <text y={16} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fontWeight={700} fill={reached ? toneFill('found') : toneFill('active')}>
          Σ {s.sum}
        </text>
      </g>
    </svg>
  );
}

function View({ frame, input }: { frame: Frame<State>; input: Input }) {
  const s = frame.state;
  const n = s.arr.length;
  const done = s.mode === 'done';
  const hasWindow = s.R >= 0 && s.L <= s.R && !done;
  const tone = (i: number): Tone | undefined => {
    if (done) return s.bestL >= 0 && i >= s.bestL && i <= s.bestR ? 'found' : 'muted';
    if (i === s.joining) return 'active';
    if (i === s.leaving) return 'muted';
    if (s.R >= 0 && i >= s.L && i <= s.R) return s.mode === 'record' ? 'done' : 'visited';
    if (i < s.L) return 'muted';
    return undefined;
  };
  const hasBest = s.bestL >= 0;
  return (
    <VizStack gap={16}>
      <StatRow
        stats={[
          { label: 'window sum', value: s.sum, tone: s.sum >= input.target ? 'found' : 'active' },
          { label: 'window length', value: s.R >= 0 ? Math.max(0, s.R - s.L + 1) : 0 },
          { label: 'best length', value: s.best === Infinity ? '—' : s.best, tone: 'path' },
          { label: 'pointer moves', value: `${s.moves} (brute force: ${(n * (n + 1)) / 2} windows)` },
        ]}
      />
      <ArrayView
        items={s.arr}
        tones={tone}
        cell={CELL}
        pointers={[
          { index: done ? -1 : s.L, label: 'L', tone: 'frontier' },
          { index: done ? -1 : s.R, label: 'R', tone: 'active' },
        ]}
        spans={[
          hasBest
            ? { from: s.bestL, to: s.bestR, label: `best · ${s.best}`, tone: 'path', side: 'top' }
            : { from: 0, to: 0, label: '', tone: 'muted', side: 'top' },
          hasWindow
            ? { from: s.L, to: s.R, label: `window · Σ ${s.sum}`, tone: s.sum >= input.target ? 'done' : 'visited', side: 'bottom' }
            : { from: 0, to: 0, label: '', tone: 'muted', side: 'bottom' },
        ]}
      />
      <VizSection label="window sum gauge" aside={s.sum >= input.target ? 'big enough — try shrinking' : done ? 'finished' : 'too small — expand'}>
        <Gauge s={s} target={input.target} />
      </VizSection>
      <Callout show={done} tone={s.result ? 'found' : 'danger'}>
        {s.result ? `shortest = ${s.result}  [${s.arr.slice(s.bestL, s.bestR + 1).join(', ')}]` : `no window reaches ${input.target} → 0`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const dur = '4s';
  return (
    <svg viewBox="0 0 120 80">
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <rect key={k} x={6 + k * 18} y={30} width={15} height={15} rx={3.5} fill="var(--ink-3)" stroke="currentColor" strokeOpacity={0.4} />
      ))}
      <rect y={27} height={21} rx={5} fill="none" stroke="#6cb6ff" strokeWidth={2}>
        <animate attributeName="x" values="4;4;4;22;40;40;4" keyTimes="0;0.2;0.4;0.55;0.7;0.9;1" dur={dur} repeatCount="indefinite" />
        <animate attributeName="width" values="19;37;73;55;55;73;19" keyTimes="0;0.2;0.4;0.55;0.7;0.9;1" dur={dur} repeatCount="indefinite" />
        <animate attributeName="stroke" values="#6cb6ff;#6cb6ff;#5fd3a5;#5fd3a5;#6cb6ff;#5fd3a5;#6cb6ff" keyTimes="0;0.2;0.4;0.55;0.7;0.9;1" dur={dur} repeatCount="indefinite" />
      </rect>
      <path d="M0 0 l-4 -6 h8 z" fill="#a98bff">
        <animateTransform attributeName="transform" type="translate" values="13 24;13 24;13 24;31 24;49 24;49 24;13 24" keyTimes="0;0.2;0.4;0.55;0.7;0.9;1" dur={dur} repeatCount="indefinite" />
      </path>
      <path d="M0 0 l-4 -6 h8 z" fill="#f5b544">
        <animateTransform attributeName="transform" type="translate" values="13 24;31 24;67 24;67 24;85 24;103 24;13 24" keyTimes="0;0.2;0.4;0.55;0.7;0.9;1" dur={dur} repeatCount="indefinite" />
      </path>
      <rect x={6} y={60} width={108} height={7} rx={3.5} fill="var(--ink-3)" />
      <rect x={6} y={60} height={7} rx={3.5} fill="currentColor">
        <animate attributeName="width" values="14;34;80;60;50;84;14" keyTimes="0;0.2;0.4;0.55;0.7;0.9;1" dur={dur} repeatCount="indefinite" />
      </rect>
      <line x1={70} y1={55} x2={70} y2={72} stroke="#ffd166" strokeWidth={1.6} strokeDasharray="3 2" />
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'two-pointers',
  name: 'Two Pointers (Sliding Window)',
  category: 'arrays',
  order: 6,
  tagline: 'Grow the window from the right, shrink it from the left — every element enters and leaves once.',
  description:
    'The **two-pointer** technique keeps a window `[L..R]` over the array. Here we find the **shortest subarray with sum ≥ target**: move `R` right to add elements until the sum is big enough, then move `L` right to drop elements while it stays big enough. Because all numbers are **positive**, adding always raises the sum and removing always lowers it — so neither pointer ever needs to go back.',
  howItWorks: [
    'Start with an empty window: `L = 0`, `sum = 0`.',
    '**Expand**: move `R` one step right and add `nums[R]` to the sum.',
    'While `sum ≥ target`: record the window length, then **shrink** by removing `nums[L]` and moving `L` right.',
    'Each pointer passes every index once, so the whole scan is O(n) instead of checking all O(n²) subarrays.',
  ],
  complexity: { time: 'O(n)', space: 'O(1)', note: 'Each index is added once (R) and removed at most once (L): at most 2n pointer moves.' },
  code: {
    js: `
function minSubarrayLen(nums, target) { //@fn
  let L = 0, sum = 0, best = Infinity; //@init
  for (let R = 0; R < nums.length; R++) { //@expand
    sum += nums[R]; //@add
    while (sum >= target) { //@check
      best = Math.min(best, R - L + 1); //@record
      sum -= nums[L++]; //@shrink
    }
  }
  return best === Infinity ? 0 : best; //@result
}`,
    py: `
def min_subarray_len(nums, target): #@fn
    L, total, best = 0, 0, float("inf") #@init
    for R in range(len(nums)): #@expand
        total += nums[R] #@add
        while total >= target: #@check
            best = min(best, R - L + 1) #@record
            total -= nums[L] #@shrink
            L += 1
    return 0 if best == float("inf") else best #@result`,
  },
  input: {
    default: { arr: [4, 2, 1, 7, 3, 1, 2, 8, 1, 5, 2, 3], target: 12 },
    presets: [
      { name: 'Classic (target 7)', value: { arr: [2, 3, 1, 2, 4, 3], target: 7 } },
      { name: 'One big element', value: { arr: [1, 1, 2, 9, 1, 1], target: 8 } },
      { name: 'Needs whole array', value: { arr: [1, 2, 3, 4, 5], target: 15 } },
      { name: 'Unreachable', value: { arr: [1, 2, 3, 1], target: 20 } },
    ],
    random: () => {
      const arr = randomArray(randInt(6, 13), 1, 9);
      const total = arr.reduce((a, b) => a + b, 0);
      return { arr, target: Math.random() < 0.9 ? randInt(6, Math.max(6, Math.floor(total * 0.6))) : total + randInt(1, 5) };
    },
    format: (v) => `${formatNumberList(v.arr)} | ${v.target}`,
    parse: (text) => {
      const [a, t, extra] = text.split('|');
      if (t === undefined) throw new Error('Add the target after a "|", e.g. "2, 3, 1, 2, 4, 3 | 7".');
      if (extra !== undefined) throw new Error('Use a single "|" between the numbers and the target.');
      const arr = parseNumberList(a, { minLen: 1, maxLen: 16, min: -999, max: 999 });
      if (arr.some((x) => x <= 0)) throw new Error('Use positive numbers only — the sliding window relies on "adding grows the sum, removing shrinks it".');
      if (arr.some((x) => x > 99)) throw new Error('Keep values between 1 and 99 so the gauge stays readable.');
      const [target] = parseNumberList(t, { minLen: 1, maxLen: 1, min: -9999, max: 9999 });
      if (target < 1 || target > 999) throw new Error('The target should be a whole number from 1 to 999.');
      return { arr, target };
    },
    placeholder: '2, 3, 1, 2, 4, 3 | 7',
    hint: 'Positive whole numbers (1–99, up to 16), then "|" and the target sum.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'joining (R)' },
    { tone: 'visited', label: 'in window' },
    { tone: 'done', label: 'window sum ≥ target' },
    { tone: 'muted', label: 'left behind (L passed)' },
    { tone: 'path', label: 'best window so far' },
    { tone: 'found', label: 'answer' },
  ],
  Glyph,
});
