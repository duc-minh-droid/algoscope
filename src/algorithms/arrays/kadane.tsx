import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizRow, VizSection, VizStack, toneFill, toneInk, type Span } from '@/viz';

type Input = number[];

type Step = 'setup' | 'init' | 'look' | 'decide' | 'cmp' | 'done';

interface State {
  arr: number[];
  step: Step;
  i: number; // element under consideration (-1 before start)
  cur: number | null; // best sum of a window ending at i
  best: number | null;
  curL: number; // current window [curL..curR], -1 when empty
  curR: number;
  bestL: number;
  bestR: number;
  x: number | null; // arr[i]
  prev: number | null; // cur before the decision
  choice: 'extend' | 'restart' | null;
  improved: boolean | null;
  hist: { cur: number; best: number }[]; // one entry per processed index
}

const fmt = (v: number) => (v < 0 ? `(${v})` : String(v));
const win = (l: number, r: number) => (l < 0 ? '—' : l === r ? `[${l}]` : `[${l}..${r}]`);

function* run(arr: Input): Generator<Frame<State>> {
  let cur = arr[0];
  let best = arr[0];
  let start = 0;
  let bestL = 0;
  let bestR = 0;
  let hist: State['hist'] = [];
  const base = {
    arr: [...arr],
    cur: null as number | null,
    best: null as number | null,
    curL: -1,
    curR: -1,
    bestL: -1,
    bestR: -1,
    x: null as number | null,
    prev: null as number | null,
    choice: null as State['choice'],
    improved: null as boolean | null,
  };
  const vars = (i: number, x?: number) => ({ i, x, cur, best, start, window: win(bestL, bestR) });

  yield {
    state: { ...base, step: 'setup', i: -1, hist: [] },
    line: 'fn',
    note: 'We want the contiguous stretch with the **largest sum**. Kadane keeps just two numbers: `cur` (best sum of a window that ends right here) and `best` (best seen anywhere).',
    vars: { i: undefined, x: undefined, cur: undefined, best: undefined, start: undefined, window: '—' },
    phase: 'scan',
  };

  hist = [{ cur, best }];
  yield {
    state: { ...base, step: 'init', i: 0, cur, best, curL: 0, curR: 0, bestL: 0, bestR: 0, x: arr[0], hist: [...hist] },
    line: 'init',
    note: `The first element **${arr[0]}** is, on its own, both the best window ending at index 0 and the best so far: \`cur = best = ${arr[0]}\`.`,
    vars: vars(0, arr[0]),
    phase: 'scan',
  };

  for (let i = 1; i < arr.length; i++) {
    const x = arr[i];
    const snap = (): Omit<State, 'step' | 'choice' | 'improved' | 'prev'> => ({
      arr: [...arr],
      i,
      cur,
      best,
      curL: start,
      curR: i,
      bestL,
      bestR,
      x,
      hist: [...hist],
    });

    yield {
      state: { ...snap(), curR: i - 1, step: 'look', prev: cur, choice: null, improved: null },
      line: 'loop',
      note: `Next up: **${x}**. Every window ending at index ${i} either **extends** the running window (sum ${cur}) or **restarts** at ${x} alone — which is bigger?`,
      vars: vars(i, x),
      phase: 'scan',
    };

    const prev = cur;
    const ext = cur + x;
    const restart = ext < x; // equivalent to cur < 0
    if (restart) {
      cur = x;
      start = i;
    } else cur = ext;
    hist = [...hist, { cur, best }];
    const why = restart
      ? `the old window sums to **${prev} < 0**, so carrying it would only drag ${x} down — **restart** here.`
      : prev === 0
        ? `the old window adds nothing (sum 0) — a tie, so we simply **extend**.`
        : `the old window sums to **${prev} ≥ 0**, so it can only help — **extend** it.`;
    yield {
      state: { ...snap(), step: 'decide', prev, choice: restart ? 'restart' : 'extend', improved: null },
      line: ['decide', restart ? 'restart' : 'extend'],
      note: `\`max(x, cur + x) = max(${x}, ${prev} + ${fmt(x)}) = max(${x}, ${ext}) = ${cur}\`: ${why}`,
      vars: vars(i, x),
      phase: 'scan',
    };

    const improved = cur > best;
    const oldBest = best;
    if (improved) {
      best = cur;
      bestL = start;
      bestR = i;
      hist = [...hist.slice(0, -1), { cur, best }];
    }
    yield {
      state: { ...snap(), step: 'cmp', prev, choice: restart ? 'restart' : 'extend', improved },
      line: improved ? ['cmp', 'best'] : 'cmp',
      note: improved
        ? `\`cur = ${cur} > best = ${oldBest}\` — a **new record**! Remember the window ${win(bestL, bestR)}.`
        : `\`cur = ${cur}\` doesn't beat \`best = ${best}\`, so the best window stays ${win(bestL, bestR)}.`,
      vars: vars(i, x),
      phase: 'scan',
    };
  }

  const parts = arr.slice(bestL, bestR + 1).map(fmt).join(' + ');
  yield {
    state: { ...base, step: 'done', i: arr.length, cur, best, bestL, bestR, hist: [...hist] },
    line: 'ret',
    note: `Done in a single pass. Maximum subarray sum = **${best}**, from window ${win(bestL, bestR)}: ${parts}${bestL === bestR ? '' : ` = ${best}`}.`,
    vars: { i: arr.length, x: undefined, cur, best, start, window: win(bestL, bestR) },
    phase: 'done',
  };
}

/* ---------- pure helpers for the View ---------- */

function trace(arr: number[]) {
  let cur = arr[0];
  let best = arr[0];
  const vals = [cur];
  for (let i = 1; i < arr.length; i++) {
    cur = Math.max(arr[i], cur + arr[i]);
    best = Math.max(best, cur);
    vals.push(cur, best);
  }
  return vals;
}

const STYLE = `
.kadane-seg { stroke-dasharray: 1; stroke-dashoffset: 1; animation: kadane-draw var(--step-ms) var(--ease-out) forwards; }
@keyframes kadane-draw { to { stroke-dashoffset: 0; } }
.kadane-pop { transform-box: fill-box; transform-origin: center; animation: kadane-pop calc(var(--step-ms) * 1.4) var(--ease-out); }
@keyframes kadane-pop { from { transform: scale(0.4); opacity: 0.2; } }
.kadane-fill { transition: fill var(--step-ms) ease, stroke var(--step-ms) ease, opacity var(--step-ms) ease; }
.kadane-move { transition: transform var(--step-ms) var(--ease-in-out), opacity var(--step-ms) ease; }
@media (prefers-reduced-motion: reduce) {
  .kadane-seg { animation: none; stroke-dashoffset: 0; }
  .kadane-pop { animation: none; }
  .kadane-move { transition: opacity 150ms ease; }
}`;

function Chart({ arr, hist, i }: { arr: number[]; hist: State['hist']; i: number }) {
  const W = 380;
  const H = 180;
  const pl = 36;
  const pr = 14;
  const pt = 16;
  const pb = 26;
  const all = trace(arr);
  const yMax = Math.max(0, ...all);
  const yMin = Math.min(0, ...all);
  const n = arr.length;
  const xOf = (k: number) => (n === 1 ? (pl + W - pr) / 2 : pl + (k * (W - pl - pr)) / (n - 1));
  const yOf = (v: number) => pt + ((yMax - v) / (yMax - yMin || 1)) * (H - pt - pb);
  const h = hist.length;
  const series: { key: 'cur' | 'best'; tone: Tone }[] = [
    { key: 'best', tone: 'path' },
    { key: 'cur', tone: 'frontier' },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.4, display: 'block', margin: '0 auto', overflow: 'visible' }} role="img" aria-label="running sums chart">
      <style>{STYLE}</style>
      {[yMax, 0, yMin].filter((v, k, a) => a.indexOf(v) === k).map((v) => (
        <g key={v}>
          <line x1={pl} x2={W - pr} y1={yOf(v)} y2={yOf(v)} stroke="var(--paper-faint)" strokeOpacity={v === 0 ? 0.7 : 0.25} strokeDasharray={v === 0 ? '4 5' : '2 6'} />
          <text x={pl - 7} y={yOf(v) + 4} textAnchor="end" fontSize={10.5} fontFamily="var(--font-mono)" fill="var(--paper-faint)">
            {v}
          </text>
        </g>
      ))}
      {arr.map((_, k) => (
        <text key={k} x={xOf(k)} y={H - 8} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill={k === i ? 'var(--amber)' : 'var(--paper-faint)'}>
          {k}
        </text>
      ))}
      {i >= 0 && i < n && (
        <line className="kadane-move" x1={0} x2={0} y1={pt - 6} y2={H - pb + 4} stroke="var(--amber)" strokeOpacity={0.45} strokeDasharray="3 4" style={{ transform: `translateX(${xOf(i)}px)` }} />
      )}
      {series.map(({ key, tone }) => {
        const pts = hist.map((e, k) => [xOf(k), yOf(e[key])] as const);
        const old = pts.slice(0, Math.max(0, h - 1));
        const last = pts[h - 1];
        const prev = pts[h - 2];
        const c = toneFill(tone);
        return (
          <g key={key}>
            {old.length > 1 && <polyline points={old.map((p) => p.join(',')).join(' ')} fill="none" stroke={c} strokeWidth={key === 'best' ? 4 : 2.4} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={key === 'best' ? 0.55 : 1} />}
            {prev && last && (
              <path
                key={`${h}-${last[1]}`}
                className="kadane-seg"
                pathLength={1}
                d={`M${prev[0]} ${prev[1]} L${last[0]} ${last[1]}`}
                fill="none"
                stroke={c}
                strokeWidth={key === 'best' ? 4 : 2.4}
                strokeLinecap="round"
                strokeOpacity={key === 'best' ? 0.55 : 1}
              />
            )}
            {pts.map((p, k) => (
              <circle key={k} cx={p[0]} cy={p[1]} r={k === h - 1 ? 4.5 : 2.6} fill={c} className={k === h - 1 ? 'kadane-pop' : undefined} />
            ))}
          </g>
        );
      })}
      <g fontFamily="var(--font-mono)" fontSize={11} fontWeight={600}>
        <rect x={pl + 6} y={2} width={10} height={4} rx={2} fill={toneFill('frontier')} />
        <text x={pl + 20} y={8} fill="var(--paper-dim)">cur</text>
        <rect x={pl + 54} y={2} width={10} height={4} rx={2} fill={toneFill('path')} />
        <text x={pl + 68} y={8} fill="var(--paper-dim)">best</text>
      </g>
    </svg>
  );
}

function Card({ x, y, w, label, value, sub, tone, state }: { x: number; y: number; w: number; label: string; value: string; sub: string; tone: Tone; state: 'win' | 'lose' | 'open' }) {
  const on = state === 'win';
  return (
    <g style={{ opacity: state === 'lose' ? 0.4 : 1 }} className="kadane-fill">
      <rect className="kadane-fill" x={x} y={y} width={w} height={62} rx={12} fill={on ? toneFill(tone) : 'var(--ink-3)'} stroke={on ? toneFill(tone) : 'var(--line-strong)'} strokeWidth={1.5} strokeDasharray={state === 'open' ? '5 4' : undefined} />
      <text x={x + w / 2} y={y + 17} textAnchor="middle" fontSize={10.5} fontFamily="var(--font-mono)" letterSpacing="0.1em" fill={on ? toneInk(tone) : 'var(--paper-faint)'}>
        {label.toUpperCase()}
      </text>
      <text x={x + w / 2} y={y + 40} textAnchor="middle" fontSize={20} fontWeight={700} fontFamily="var(--font-mono)" fill={on ? toneInk(tone) : 'var(--paper)'}>
        {value}
      </text>
      <text x={x + w / 2} y={y + 55} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill={on ? toneInk(tone) : 'var(--paper-faint)'}>
        {sub}
      </text>
      {state === 'lose' && <line x1={x + 10} x2={x + w - 10} y1={y + 34} y2={y + 34} stroke="var(--paper-dim)" strokeWidth={2} strokeLinecap="round" />}
    </g>
  );
}

function Decision({ s }: { s: State }) {
  const W = 380;
  const H = 180;
  const hasX = (s.step === 'look' || s.step === 'decide' || s.step === 'cmp') && s.x !== null && s.prev !== null;
  const x = s.x ?? 0;
  const prev = s.prev ?? 0;
  const decided = s.step === 'decide' || s.step === 'cmp';
  const rs: 'win' | 'lose' | 'open' = !decided ? 'open' : s.choice === 'restart' ? 'win' : 'lose';
  const es: 'win' | 'lose' | 'open' = !decided ? 'open' : s.choice === 'extend' ? 'win' : 'lose';
  const cmpDone = s.step === 'cmp';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.4, display: 'block', margin: '0 auto' }} role="img" aria-label="extend or restart decision">
      <text x={W / 2} y={16} textAnchor="middle" fontSize={13} fontFamily="var(--font-mono)" fill="var(--paper-dim)">
        cur = max( <tspan fill={toneFill('active')}>x</tspan> , cur + <tspan fill={toneFill('active')}>x</tspan> )
      </text>
      {hasX ? (
        <>
          <Card x={20} y={28} w={150} label="restart" value={String(x)} sub={`start fresh at ${s.i}`} tone="frontier" state={rs} />
          <text x={W / 2} y={66} textAnchor="middle" fontSize={13} fontFamily="var(--font-mono)" fill="var(--paper-faint)">
            vs
          </text>
          <Card x={210} y={28} w={150} label="extend" value={String(prev + x)} sub={`${prev} + ${fmt(x)}`} tone="frontier" state={es} />
        </>
      ) : (
        <text x={W / 2} y={68} textAnchor="middle" fontSize={13} fontStyle="italic" fill="var(--paper-faint)">
          {s.step === 'done' ? 'scan finished' : s.step === 'init' ? 'first element: nothing to decide yet' : 'waiting for the first element…'}
        </text>
      )}
      <g transform="translate(0 108)">
        <text x={W / 2} y={12} textAnchor="middle" fontSize={13} fontFamily="var(--font-mono)" fill="var(--paper-dim)">
          best = max( best , cur )
        </text>
        {s.best !== null && s.cur !== null && (
          <>
            <rect className="kadane-fill" x={70} y={24} width={110} height={36} rx={18} fill={cmpDone && !s.improved ? toneFill('path') : 'var(--ink-3)'} stroke={toneFill('path')} strokeWidth={1.5} />
            <text x={125} y={47} textAnchor="middle" fontSize={15} fontWeight={700} fontFamily="var(--font-mono)" fill={cmpDone && !s.improved ? toneInk('path') : 'var(--paper)'}>
              best {s.improved && cmpDone ? '→' : '='} {s.best}
            </text>
            <rect className="kadane-fill" x={200} y={24} width={110} height={36} rx={18} fill={cmpDone && s.improved ? toneFill('path') : 'var(--ink-3)'} stroke={toneFill('frontier')} strokeWidth={1.5} />
            <text x={255} y={47} textAnchor="middle" fontSize={15} fontWeight={700} fontFamily="var(--font-mono)" fill={cmpDone && s.improved ? toneInk('path') : 'var(--paper)'}>
              cur = {s.cur}
            </text>
          </>
        )}
      </g>
    </svg>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const { arr, i, step } = s;
  const done = step === 'done';
  const inCur = (k: number) => s.curL >= 0 && k >= s.curL && k <= s.curR;
  const inBest = (k: number) => s.bestL >= 0 && k >= s.bestL && k <= s.bestR;
  const tone = (k: number): Tone | undefined => {
    if (done) return inBest(k) ? 'found' : 'muted';
    if (k === i && step === 'look') return 'active';
    if (inCur(k)) return 'frontier';
    if (inBest(k)) return 'path';
    if (k < i) return 'muted';
    return undefined;
  };
  const spans: Span[] = [];
  if (!done && s.curL >= 0) spans.push({ from: s.curL, to: s.curR, label: `cur ${s.cur}`, tone: 'frontier' });
  if (s.bestL >= 0) spans.push({ from: s.bestL, to: s.bestR, label: `best ${s.best}`, tone: done ? 'found' : 'path' });
  return (
    <VizStack gap={20}>
      <StatRow
        stats={[
          { label: 'x = arr[i]', value: s.x ?? '—', tone: 'active' },
          { label: 'cur (ends here)', value: s.cur ?? '—', tone: 'frontier' },
          { label: 'best so far', value: s.best ?? '—', tone: 'path' },
          { label: 'best window', value: win(s.bestL, s.bestR) },
        ]}
      />
      <ArrayView
        items={arr}
        variant="bars"
        tones={tone}
        spans={spans}
        pointers={[{ index: i >= 0 && i < arr.length ? i : -1, label: 'i', tone: 'active' }]}
        cell={arr.length > 12 ? 40 : 48}
        barHeight={150}
      />
      <VizRow>
        <VizSection label="the decision" aside={s.choice ? (s.choice === 'restart' ? 'restart ↺' : 'extend →') : undefined}>
          <Decision s={s} />
        </VizSection>
        <VizSection label="running sums" aside="cur vs best, step by step">
          <Chart arr={arr} hist={s.hist} i={i} />
        </VizSection>
      </VizRow>
      <Callout show={done} tone="found">
        max sum = {s.best} · window {win(s.bestL, s.bestR)}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const vals = [-2, 3, -1, 4, -3, 2];
  const zero = 44;
  return (
    <svg viewBox="0 0 120 80">
      <line x1={6} x2={114} y1={zero} y2={zero} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
      {vals.map((v, k) => (
        <rect key={k} x={10 + k * 17} y={v >= 0 ? zero - v * 7 : zero} width={12} height={Math.abs(v) * 7} rx={2} fill="currentColor" fillOpacity={v >= 0 ? 0.75 : 0.3} />
      ))}
      <path d="M27 70 v4 h63 v-4" fill="none" stroke="#ffd166" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0}>
        <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.6;0.7;0.95;1" dur="4s" repeatCount="indefinite" />
      </path>
      <rect y={8} height={62} rx={4} fill="none" stroke="#a98bff" strokeWidth={1.8} strokeDasharray="4 3">
        <animate attributeName="x" values="8;25;25;25;25;8" keyTimes="0;0.15;0.3;0.45;0.95;1" dur="4s" repeatCount="indefinite" />
        <animate attributeName="width" values="16;16;33;67;67;16" keyTimes="0;0.15;0.3;0.45;0.95;1" dur="4s" repeatCount="indefinite" />
      </rect>
      <polyline points="16,64 33,58 50,61 67,50 84,56 101,52" fill="none" stroke="#a98bff" strokeWidth={1.5} strokeDasharray="100" strokeDashoffset="100" strokeOpacity={0.8}>
        <animate attributeName="stroke-dashoffset" values="100;0;0" keyTimes="0;0.6;1" dur="4s" repeatCount="indefinite" />
      </polyline>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'kadane',
  name: "Kadane's Algorithm",
  category: 'arrays',
  order: 1,
  tagline: 'Maximum subarray sum in one pass: at every element, extend the run or start over.',
  description:
    'Find the contiguous slice of an array with the **largest sum** — negatives included. Instead of trying all O(n²) windows, Kadane asks one question per element: is the best window ending here `x` alone, or `x` glued onto the best window ending just before? That tiny recurrence, `cur = max(x, cur + x)`, solves the whole problem in a single sweep.',
  howItWorks: [
    '`cur` = best sum of a window that **ends at the current index**; `best` = best sum seen anywhere.',
    'For each new `x`: if `cur` is negative it can only hurt, so **restart** at `x`; otherwise **extend** with `cur + x`.',
    'After each step, if `cur` beats `best`, record it (and where the window starts/ends).',
    'All-negative arrays still work: the answer is simply the largest (least negative) element.',
  ],
  complexity: { time: 'O(n)', space: 'O(1)', note: 'One pass, two running numbers (plus indices if you want the window itself).' },
  code: {
    js: `
function maxSubarray(arr) { //@fn
  let cur = arr[0], best = arr[0]; //@init
  let start = 0, bestL = 0, bestR = 0;
  for (let i = 1; i < arr.length; i++) { //@loop
    const x = arr[i];
    // cur = max(x, cur + x)
    if (cur + x < x) { //@decide
      cur = x; start = i; //@restart
    } else {
      cur = cur + x; //@extend
    }
    if (cur > best) { //@cmp
      best = cur; bestL = start; bestR = i; //@best
    }
  }
  return best; //@ret
}`,
    py: `
def max_subarray(arr): #@fn
    cur = best = arr[0] #@init
    start = best_l = best_r = 0
    for i in range(1, len(arr)): #@loop
        x = arr[i]
        # cur = max(x, cur + x)
        if cur + x < x: #@decide
            cur, start = x, i #@restart
        else:
            cur = cur + x #@extend
        if cur > best: #@cmp
            best, best_l, best_r = cur, start, i #@best
    return best #@ret`,
  },
  input: {
    default: [2, -3, 4, -1, -2, 1, 5, -3, -6, 3, 2, -1],
    presets: [
      { name: 'Mixed (classic)', value: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
      { name: 'All negative', value: [-8, -3, -6, -2, -5, -4] },
      { name: 'All positive', value: [3, 1, 4, 1, 5, 9, 2] },
      { name: 'Deep dip', value: [6, 4, -20, 5, 3, -1, 2] },
      { name: 'Single element', value: [-7] },
    ],
    random: () => Array.from({ length: randInt(7, 13) }, () => randInt(-9, 9)),
    format: formatNumberList,
    parse: (text) => parseNumberList(text, { min: -99, max: 99, minLen: 1, maxLen: 16 }),
    placeholder: '-2, 1, -3, 4, -1, 2, 1, -5, 4',
    hint: '1–16 whole numbers between -99 and 99, negatives welcome.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'next element x' },
    { tone: 'frontier', label: 'current window (cur)' },
    { tone: 'path', label: 'best window so far' },
    { tone: 'muted', label: 'left behind' },
    { tone: 'found', label: 'answer' },
  ],
  Glyph,
});
