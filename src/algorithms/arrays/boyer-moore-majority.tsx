import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt, shuffle } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizRow, VizSection, VizStack, toneFill, toneInk } from '@/viz';
import { avGeom, jitter, sketchArc, sketchLine } from './_arraysB';

interface Input {
  arr: number[];
}

interface Chip {
  id: number; // index of the voter it came from
  value: number;
}

type Stage = 'setup' | 'vote' | 'survivor' | 'verify' | 'done';

interface State {
  arr: number[];
  stage: Stage;
  i: number; // current voter in phase 1 (-1 = none)
  act: 'adopt' | 'vote' | 'cancel' | null;
  cand: number | null;
  since: number; // index where the current candidate was adopted (keys the badge animation)
  stack: Chip[]; // live supporters; length === count
  popped: Chip | null; // chip cancelled in this frame
  pairs: [number, number][]; // cancelled pairs (older supporter, challenger)
  vi: number; // verification cursor (-1 = none)
  counted: number[]; // indices that matched the candidate in phase 2
  result: number | null | undefined; // undefined until finished
  cap: number; // tallest the stack ever gets (for a stable layout)
}

const CELL = 50;

function* run({ arr }: Input): Generator<Frame<State>> {
  const n = arr.length;
  // dry run for the stack height so the chip tower never re-lays-out
  let cap = 1;
  {
    let c = 0;
    let cd: number | null = null;
    for (const x of arr) {
      if (c === 0) cd = x;
      c += x === cd ? 1 : -1;
      cap = Math.max(cap, c);
    }
  }
  let cand: number | null = null;
  let since = -1;
  const stack: Chip[] = [];
  const pairs: [number, number][] = [];
  const counted: number[] = [];
  const snap = (o: Partial<State>): State => ({
    arr: [...arr],
    stage: 'vote',
    i: -1,
    act: null,
    cand,
    since,
    stack: stack.map((c) => ({ ...c })),
    popped: null,
    pairs: pairs.map((p) => [p[0], p[1]] as [number, number]),
    vi: -1,
    counted: [...counted],
    result: undefined,
    cap,
    ...o,
  });
  const need = Math.floor(n / 2) + 1;

  yield {
    state: snap({ stage: 'setup' }),
    line: ['fn', 'init'],
    note: `A **majority** element appears more than n/2 = **${n / 2}** times. Think of each value as a vote: two different votes **cancel each other out**, and a true majority has more votes than everyone else combined — so it must survive.`,
    vars: { x: undefined, candidate: null, count: 0, seen: undefined },
    phase: 'vote',
  };

  for (let i = 0; i < n; i++) {
    const x = arr[i];
    if (stack.length === 0) {
      const prev = cand;
      cand = x;
      since = i;
      yield {
        state: snap({ i, act: 'adopt' }),
        line: ['loop', 'zero', 'adopt'],
        note:
          prev === null
            ? `Nobody is standing yet (count = 0), so the first voter **${x}** becomes the candidate.`
            : `Count is **0** — every supporter of ${prev} has been cancelled. The field is empty, so **${x}** steps up as the new candidate.`,
        vars: { x, candidate: cand, count: 0, seen: undefined },
        phase: 'vote',
      };
      stack.push({ id: i, value: x });
      yield {
        state: snap({ i, act: 'vote' }),
        line: 'vote',
        note: `**${x}** votes for itself: drop a chip on the tower. count = **1**.`,
        vars: { x, candidate: cand, count: stack.length, seen: undefined },
        phase: 'vote',
      };
    } else if (x === cand) {
      stack.push({ id: i, value: x });
      yield {
        state: snap({ i, act: 'vote' }),
        line: ['loop', 'vote'],
        note: `**${x}** matches the candidate — another supporter. Add a chip: count = **${stack.length}**.`,
        vars: { x, candidate: cand, count: stack.length, seen: undefined },
        phase: 'vote',
      };
    } else {
      const chip = stack.pop()!;
      pairs.push([chip.id, i]);
      yield {
        state: snap({ i, act: 'cancel', popped: chip }),
        line: ['loop', 'cancel'],
        note: `**${x}** ≠ ${cand}: pair it with one ${cand}-supporter (index ${chip.id}) and **strike both out**. Removing two *different* votes never hurts a real majority — it still outnumbers the rest. count = **${stack.length}**.`,
        vars: { x, candidate: cand, count: stack.length, seen: undefined },
        phase: 'vote',
      };
    }
  }

  yield {
    state: snap({ stage: 'survivor' }),
    line: 'loop',
    note:
      stack.length === 0
        ? `All votes are in — and **every** vote was cancelled (${pairs.length} pairs). The variable still holds **${cand}**, but only because it was the last one adopted: a very shaky claim.`
        : `All votes are in. **${cand}** is the last one standing with **${stack.length}** uncancelled chip${stack.length === 1 ? '' : 's'} (${pairs.length} pair${pairs.length === 1 ? '' : 's'} cancelled).`,
    vars: { x: undefined, candidate: cand, count: stack.length, seen: undefined },
    phase: 'verify',
  };

  yield {
    state: snap({ stage: 'verify' }),
    line: 'verify',
    note: `But surviving ≠ winning! If there is **no** majority, *someone* still survives the cancelling (e.g. \`1, 2, 3\` leaves 3). So phase 2 counts ${cand}'s votes honestly: it needs at least **${need}** of ${n}.`,
    vars: { x: undefined, candidate: cand, count: stack.length, seen: 0 },
    phase: 'verify',
  };

  for (let vi = 0; vi < n; vi++) {
    const x = arr[vi];
    const hit = x === cand;
    if (hit) counted.push(vi);
    yield {
      state: snap({ stage: 'verify', vi }),
      line: 'tally',
      note: hit
        ? `**${x}** = ${cand} → tally **${counted.length}**${counted.length === need ? ` — that's already more than half!` : '.'}`
        : `${x} ≠ ${cand}, not a vote for the candidate. Tally stays **${counted.length}**.`,
      vars: { x, candidate: cand, count: stack.length, seen: counted.length },
      phase: 'verify',
    };
  }

  const ok = counted.length > n / 2;
  yield {
    state: snap({ stage: 'done', result: ok ? cand : null }),
    line: 'result',
    note: ok
      ? `**${cand}** has **${counted.length}** of ${n} votes > ${n / 2}. Confirmed majority — found in two linear passes and O(1) memory.`
      : `${cand} only has **${counted.length}** of ${n} votes, not more than ${n / 2}. The survivor was an impostor: there is **no majority**, return \`null\`.`,
    vars: { x: undefined, candidate: cand, count: stack.length, seen: counted.length },
    phase: 'done',
  };
}

/** Cancelled pairs drawn as hand-drawn brackets under the array — they nest like parentheses (it's a stack!). */
function PairLane({ n, pairs, dim }: { n: number; pairs: [number, number][]; dim: boolean }) {
  const g = avGeom(n, CELL);
  const H = 58;
  return (
    <svg viewBox={`0 0 ${g.W} ${H}`} style={{ ...g.style, opacity: dim ? 0.4 : 1, transition: 'opacity var(--step-ms) ease' }} aria-hidden>
      {pairs.map(([a, b], k) => {
        const x1 = g.cx(a);
        const x2 = g.cx(b);
        const depth = Math.min(46, 12 + (b - a) * 5);
        const mx = (x1 + x2) / 2;
        const my = 4 + depth / 2 + 1;
        const newest = k === pairs.length - 1;
        return (
          <g key={`${a}-${b}`} className={newest ? 'bmm-new' : undefined}>
            <path className="bmm-draw" pathLength={1} d={sketchArc(x1, x2, 4, depth, a * 13 + b)} fill="none" stroke={toneFill('compare')} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.85} />
            <path className="bmm-x" d={`${sketchLine(mx - 5, my - 5, mx + 5, my + 5, a + b, 0.8)} ${sketchLine(mx + 5, my - 5, mx - 5, my + 5, a + b + 9, 0.8)}`} stroke={toneFill('compare')} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          </g>
        );
      })}
      {pairs.length === 0 && (
        <text x={g.W / 2} y={24} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--paper-faint)">
          cancelled pairs will be linked here
        </text>
      )}
    </svg>
  );
}

/** The candidate's chip tower: grows on a matching vote, loses its top chip when a challenger cancels it. */
function ChipTower({ s }: { s: State }) {
  const CH = 15;
  const GAP = 3;
  const W = 280;
  const base = 36 + (s.cap + 1) * (CH + GAP);
  const H = base + 26;
  const tx = 150;
  const cw = 92;
  const chipY = (lvl: number) => base - (lvl + 1) * (CH + GAP);
  const challenger = s.act === 'cancel' ? s.arr[s.i] : null;
  const badgeTone: Tone = s.result === null ? 'danger' : s.result !== undefined ? 'found' : 'frontier';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: W * 1.4, margin: '0 auto', overflow: 'visible' }} aria-label="candidate chip tower">
      <style>{`
        .bmm-chip-in { animation: bmm-drop var(--step-ms) var(--ease-out); }
        .bmm-pop { animation: bmm-pop calc(var(--step-ms) * 1.3) var(--ease-out) forwards; }
        .bmm-clash { animation: bmm-clash calc(var(--step-ms) * 1.3) var(--ease-out) forwards; }
        .bmm-spark { animation: bmm-spark calc(var(--step-ms) * 1.3) var(--ease-out) forwards; transform-box: fill-box; transform-origin: center; }
        .bmm-badge { animation: bmm-badge calc(var(--step-ms) * 1.2) var(--ease-out); transform-box: fill-box; transform-origin: center; }
        .bmm-draw { stroke-dasharray: 1; stroke-dashoffset: 0; }
        .bmm-new .bmm-draw { stroke-dashoffset: 1; animation: bmm-draw calc(var(--step-ms) * 1.3) var(--ease-out) forwards; }
        .bmm-new .bmm-x { animation: bmm-fade calc(var(--step-ms) * 1.6) var(--ease-out); }
        @keyframes bmm-drop { from { transform: translateY(-26px); opacity: 0; } }
        @keyframes bmm-pop { 0% { transform: none; opacity: 1; } 45% { transform: translateX(10px); opacity: 1; } 100% { transform: translate(24px, 18px) rotate(10deg); opacity: 0; } }
        @keyframes bmm-clash { 0% { transform: translateX(60px); opacity: 0; } 45% { transform: translateX(8px); opacity: 1; } 100% { transform: translate(-6px, 18px) rotate(-10deg); opacity: 0; } }
        @keyframes bmm-spark { 0%, 35% { opacity: 0; transform: scale(0.5); } 55% { opacity: 1; transform: scale(1.15); } 100% { opacity: 0.9; transform: none; } }
        @keyframes bmm-badge { from { transform: scale(0.7) rotate(-12deg); opacity: 0.2; } }
        @keyframes bmm-draw { to { stroke-dashoffset: 0; } }
        @keyframes bmm-fade { 0%, 50% { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .bmm-chip-in, .bmm-badge, .bmm-new .bmm-x { animation: none; }
          .bmm-pop, .bmm-clash { animation-duration: 1ms; }
          .bmm-new .bmm-draw { animation-duration: 1ms; }
        }
      `}</style>
      {/* candidate badge */}
      <g transform="translate(48 58)">
        <text y={-38} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10.5} letterSpacing="0.12em" fill="var(--paper-faint)">
          CANDIDATE
        </text>
        <g key={`badge-${s.since}`} className="bmm-badge">
          <circle r={27} fill={s.cand === null ? 'none' : toneFill(badgeTone)} stroke={s.cand === null ? 'var(--line-strong)' : 'none'} strokeDasharray="4 4" />
          <text y={10} textAnchor="middle" fontFamily="var(--font-display)" fontSize={30} fill={s.cand === null ? 'var(--paper-faint)' : toneInk(badgeTone)}>
            {s.cand ?? '?'}
          </text>
        </g>
        <text y={48} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={12} fill="var(--paper-dim)">
          count = {s.stack.length}
        </text>
      </g>
      {/* tray */}
      <path d={sketchLine(tx - 8, base + 2, tx + cw + 8, base + 2, 3, 1)} stroke="var(--paper-dim)" strokeWidth={2} fill="none" strokeLinecap="round" />
      <text x={tx + cw / 2} y={base + 18} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10.5} fill="var(--paper-faint)">
        votes still standing
      </text>
      {s.stack.length === 0 && !s.popped && (
        <rect x={tx} y={chipY(0)} width={cw} height={CH} rx={7} fill="none" stroke="var(--line-strong)" strokeDasharray="4 4" />
      )}
      {s.stack.map((c, lvl) => (
        <g key={c.id} className="bmm-chip-in">
          <g transform={`translate(${tx + jitter(c.id) * 3} ${chipY(lvl)})`}>
            <rect width={cw} height={CH} rx={7} fill={toneFill(s.stage === 'done' && s.result === null ? 'danger' : 'frontier')} />
            <text x={cw / 2} y={11} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10.5} fontWeight={700} fill="#0b0f18">
              {c.value} · #{c.id}
            </text>
          </g>
        </g>
      ))}
      {s.popped && (
        <g key={`pop-${s.popped.id}-${s.i}`}>
          <g transform={`translate(${tx} ${chipY(s.stack.length)})`}>
            <g className="bmm-pop">
              <rect width={cw} height={CH} rx={7} fill={toneFill('frontier')} />
              <text x={cw / 2} y={11} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10.5} fontWeight={700} fill="#0b0f18">
                {s.popped.value} · #{s.popped.id}
              </text>
            </g>
            <g className="bmm-clash" transform={`translate(0 0)`}>
              <g transform={`translate(${cw + 6} 0)`}>
                <rect width={cw * 0.62} height={CH} rx={7} fill={toneFill('compare')} />
                <text x={cw * 0.31} y={11} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10.5} fontWeight={700} fill="#0b0f18">
                  {challenger} · #{s.i}
                </text>
              </g>
            </g>
            <g className="bmm-spark">
              <path d={`M${cw + 3} ${-6} l0 ${CH + 12} M${cw - 5} ${-2} l16 ${CH + 4} M${cw + 11} ${-2} l-16 ${CH + 4}`} stroke={toneFill('active')} strokeWidth={2} strokeLinecap="round" />
            </g>
          </g>
        </g>
      )}
    </svg>
  );
}

/** Phase 2: an honest tally against the "more than half" line. */
function VerifyGauge({ s }: { s: State }) {
  const n = s.arr.length;
  const W = 280;
  const x0 = 16;
  const bw = W - 32;
  const seg = bw / n;
  const active = s.stage === 'verify' || s.stage === 'done';
  const seen = s.counted.length;
  const passed = seen > n / 2;
  const tone: Tone = s.stage === 'done' ? (passed ? 'found' : 'danger') : passed ? 'found' : 'active';
  const lineX = x0 + (n / 2) * seg;
  return (
    <svg viewBox={`0 0 ${W} 120`} style={{ display: 'block', width: '100%', maxWidth: W * 1.4, margin: '0 auto', overflow: 'visible', opacity: active ? 1 : 0.35, transition: 'opacity var(--step-ms) ease' }} aria-label="verification tally">
      <text x={x0} y={22} fontFamily="var(--font-mono)" fontSize={10.5} letterSpacing="0.12em" fill="var(--paper-faint)">
        VOTES FOR {s.cand ?? '?'}
      </text>
      <text x={W - 16} y={22} textAnchor="end" fontFamily="var(--font-mono)" fontSize={14} fontWeight={700} fill={active ? toneFill(tone) : 'var(--paper-faint)'}>
        {active ? `${seen} / ${n}` : '—'}
      </text>
      <rect x={x0} y={40} width={bw} height={26} rx={8} fill="var(--ink-3)" stroke="var(--line-strong)" />
      {Array.from({ length: n }, (_, k) => (
        <rect
          key={k}
          x={x0 + k * seg + 1.5}
          y={42}
          width={Math.max(1, seg - 3)}
          height={22}
          rx={5}
          fill={toneFill(tone)}
          style={{ opacity: k < seen ? 1 : 0, transition: 'opacity var(--step-ms) ease, fill var(--step-ms) ease' }}
        />
      ))}
      <path d={sketchLine(lineX, 32, lineX, 76, 5, 1)} stroke={toneFill('path')} strokeWidth={2} strokeDasharray="5 4" fill="none" />
      <text x={lineX} y={92} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill={toneFill('path')}>
        n/2 = {n / 2}
      </text>
      <text x={W / 2} y={112} textAnchor="middle" fontFamily="var(--font-display)" fontStyle="italic" fontSize={15} fill="var(--paper-dim)">
        {active ? 'must cross the line to be a majority' : 'phase 2 · verification'}
      </text>
    </svg>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const inStack = new Set(s.stack.map((c) => c.id));
  const cancelled = new Set(s.pairs.flat());
  const verifying = s.stage === 'verify' || s.stage === 'done';
  const counted = new Set(s.counted);
  const tone = (k: number): Tone | undefined => {
    if (verifying) {
      if (counted.has(k)) return s.stage === 'done' && s.result === null ? 'danger' : 'found';
      if (k === s.vi) return 'active';
      if (s.stage === 'done' || k < s.vi) return 'muted';
      return undefined;
    }
    if (k === s.i) return s.act === 'cancel' ? 'compare' : 'active';
    if (s.popped && k === s.popped.id) return 'compare';
    if (inStack.has(k)) return 'frontier';
    if (cancelled.has(k)) return 'muted';
    return undefined;
  };
  const n = s.arr.length;
  const ptr = verifying ? s.vi : s.i;
  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'candidate', value: s.cand ?? '—', tone: 'frontier' },
          { label: 'count', value: s.stack.length },
          { label: 'pairs cancelled', value: s.pairs.length, tone: 'compare' },
          { label: 'verified votes', value: verifying ? `${s.counted.length} / need ${Math.floor(n / 2) + 1}` : '—' },
        ]}
      />
      <div>
        <ArrayView items={s.arr} tones={tone} pointers={[{ index: ptr, label: verifying ? 'check' : 'x', tone: 'active' }]} cell={CELL} />
        <PairLane n={n} pairs={s.pairs} dim={verifying} />
      </div>
      <VizRow>
        <VizSection label="phase 1 · the vote">
          <ChipTower s={s} />
        </VizSection>
        <VizSection label="phase 2 · the recount">
          <VerifyGauge s={s} />
        </VizSection>
      </VizRow>
      <Callout show={s.result !== undefined} tone={s.result === null ? 'danger' : 'found'}>
        {s.result === null ? `no majority — ${s.cand} has only ${s.counted.length} of ${n}` : `majority = ${s.result} (${s.counted.length} of ${n})`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const dur = '3.2s';
  return (
    <svg viewBox="0 0 120 80">
      <line x1={30} y1={66} x2={78} y2={66} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      {[0, 1].map((k) => (
        <rect key={k} x={32} y={52 - k * 12} width={44} height={10} rx={5} fill="#a98bff" />
      ))}
      <rect x={32} y={28} width={44} height={10} rx={5} fill="#a98bff">
        <animate attributeName="opacity" values="0;1;1;1;0;0" keyTimes="0;0.15;0.45;0.6;0.72;1" dur={dur} repeatCount="indefinite" />
        <animate attributeName="y" values="14;28;28;28;36;36" keyTimes="0;0.15;0.45;0.6;0.72;1" dur={dur} repeatCount="indefinite" />
      </rect>
      <rect x={116} y={28} width={30} height={10} rx={5} fill="#ff6b5b">
        <animate attributeName="x" values="116;116;116;80;76;76" keyTimes="0;0.15;0.45;0.6;0.72;1" dur={dur} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;0.15;0.45;0.6;0.72;1" dur={dur} repeatCount="indefinite" />
      </rect>
      <path d="M78 22 l0 22 M71 25 l14 16 M85 25 l-14 16" stroke="#f5b544" strokeWidth={2} strokeLinecap="round" opacity={0}>
        <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.58;0.64;0.8;1" dur={dur} repeatCount="indefinite" />
      </path>
      <circle cx={16} cy={20} r={9} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <text x={16} y={24} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">
        3
      </text>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'boyer-moore-majority',
  name: 'Boyer–Moore Majority Vote',
  category: 'arrays',
  order: 5,
  tagline: 'Pair up different votes and cancel them — whatever survives is the only possible majority.',
  description:
    'A **majority** element occurs more than n/2 times. Boyer–Moore keeps just one **candidate** and a **count**: a matching vote adds 1, a different vote cancels one supporter. Because a true majority outnumbers all other values combined, it can never be fully cancelled. A second pass **verifies** the survivor, since without a majority the survivor is meaningless.',
  howItWorks: [
    'If `count` is 0, adopt the current value as the new candidate.',
    'Same as candidate → `count++`; different → `count--` (a pair of unlike votes cancels).',
    'After one pass, only the candidate can possibly be the majority.',
    'Recount the candidate: return it only if it appears more than n/2 times.',
  ],
  complexity: { time: 'O(n)', space: 'O(1)', note: 'Two linear passes, two variables — no hash map of counts needed.' },
  code: {
    js: `
function majority(nums) { //@fn
  let cand = null, count = 0; //@init
  for (const x of nums) { //@loop
    if (count === 0) { //@zero
      cand = x; //@adopt
    }
    if (x === cand) count++; //@vote
    else count--; //@cancel
  }
  // phase 2: the survivor must be verified
  let seen = 0; //@verify
  for (const x of nums) if (x === cand) seen++; //@tally
  return seen > nums.length / 2 ? cand : null; //@result
}`,
    py: `
def majority(nums): #@fn
    cand, count = None, 0 #@init
    for x in nums: #@loop
        if count == 0: #@zero
            cand = x #@adopt
        if x == cand:
            count += 1 #@vote
        else:
            count -= 1 #@cancel
    # phase 2: the survivor must be verified
    seen = 0 #@verify
    seen = sum(1 for x in nums if x == cand) #@tally
    return cand if seen > len(nums) / 2 else None #@result`,
  },
  input: {
    default: { arr: [3, 3, 1, 3, 2, 1, 3, 3, 2, 3, 1, 3] },
    presets: [
      { name: 'No majority (impostor)', value: { arr: [1, 1, 2, 2, 3, 3, 4] } },
      { name: 'Majority hides late', value: { arr: [1, 2, 3, 7, 4, 7, 7, 7, 7] } },
      { name: 'Exactly half (fails)', value: { arr: [5, 8, 5, 8, 5, 8] } },
      { name: 'Single vote', value: { arr: [9] } },
    ],
    random: () => {
      const n = randInt(5, 13);
      if (Math.random() < 0.6) {
        const maj = randInt(1, 9);
        const m = Math.floor(n / 2) + 1 + randInt(0, 1);
        const rest = Array.from({ length: Math.max(0, n - m) }, () => {
          let v = randInt(1, 9);
          while (v === maj) v = randInt(1, 9);
          return v;
        });
        return { arr: shuffle([...Array(Math.min(m, n)).fill(maj), ...rest]) };
      }
      return { arr: Array.from({ length: n }, () => randInt(1, 5)) };
    },
    format: (v) => formatNumberList(v.arr),
    parse: (text) => ({ arr: parseNumberList(text, { minLen: 1, maxLen: 16, min: 0, max: 99 }) }),
    placeholder: '3, 3, 1, 3, 2, 3',
    hint: 'Votes as whole numbers 0–99, comma separated, up to 16.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current vote' },
    { tone: 'frontier', label: 'candidate supporter (chip)' },
    { tone: 'compare', label: 'cancelling pair' },
    { tone: 'muted', label: 'cancelled / not a vote' },
    { tone: 'found', label: 'verified vote' },
    { tone: 'danger', label: 'failed verification' },
  ],
  Glyph,
});
