import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { Callout, StatRow, VizStack, toneFill, toneInk } from '@/viz';

interface Input {
  n: number; // number of nodes (3–14)
  loop: number | null; // index the tail links back to, or null
}

interface Tok {
  node: number; // -1 = null
  ang: number; // unwrapped rotation (deg) so tokens glide along the ring
}

type Who = 'slow' | 'fast' | 'p';

interface State {
  n: number;
  loop: number | null;
  slow: Tok;
  fast: Tok | null; // null = hidden
  p: Tok | null;
  meet: number;
  start: number;
  len: number;
  counted: number[];
  trail: { from: number; who: Who }[];
  steps: number;
  gap: number | null;
  done: boolean;
  noCycle: boolean;
}

function* run({ n, loop }: Input): Generator<Frame<State>> {
  const L = loop === null ? 0 : n - loop;
  const nxt = (k: number) => (k < 0 ? -1 : k < n - 1 ? k + 1 : (loop ?? -1));
  const inCyc = (k: number) => loop !== null && k >= loop;
  const hop = (t: Tok): Tok => {
    const to = nxt(t.node);
    return { node: to, ang: inCyc(t.node) && inCyc(to) ? t.ang + 360 / L : t.ang };
  };
  const gapOf = (s: Tok, f: Tok) => (inCyc(s.node) && inCyc(f.node) ? (s.node - f.node + L) % L : null);

  let slow: Tok = { node: 0, ang: 0 };
  let fast: Tok | null = { node: 0, ang: 0 };
  let p: Tok | null = null;
  let meet = -1;
  let start = -1;
  let len = 0;
  let counted: number[] = [];
  let steps = 0;
  const snap = (trail: State['trail'] = [], extra: Partial<State> = {}): State => ({
    n,
    loop,
    slow: { ...slow },
    fast: fast && { ...fast },
    p: p && { ...p },
    meet,
    start,
    len,
    counted: [...counted],
    trail,
    steps,
    gap: fast && fast.node >= 0 ? gapOf(slow, fast) : null,
    done: false,
    noCycle: false,
    ...extra,
  });
  const nm = (k: number) => (k < 0 ? 'null' : `node ${k}`);
  const vars = () => ({ slow: nm(slow.node), fast: fast ? nm(fast.node) : '—', steps, meet: meet < 0 ? '—' : meet, start: start < 0 ? '—' : start, len: len || '—' });

  yield {
    state: snap(),
    line: 'fn',
    note: `A linked list of **${n} nodes**. Does following \`next\` ever loop back? Floyd's trick uses only two pointers: a **tortoise** (1 step) and a **hare** (2 steps), both starting at the head.`,
    vars: vars(),
    phase: 'meet',
  };
  yield {
    state: snap(),
    line: 'init',
    note: 'If there is no cycle the hare simply runs off the end. If there is one, the hare gets trapped in the loop and must eventually **lap** the tortoise.',
    vars: vars(),
    phase: 'meet',
  };

  // ---- phase 1: find a meeting point ----
  for (;;) {
    if (!fast || fast.node < 0 || nxt(fast.node) < 0) {
      const f = fast && fast.node >= 0 ? fast.node : -1;
      yield {
        state: snap([], { done: true, noCycle: true }),
        line: ['loop', 'none'],
        note:
          f < 0
            ? `The hare jumped past the last node into **null** — a list with an end cannot contain a cycle. Return \`null\`.`
            : `The hare stands on node ${f}, whose \`next\` is **null** — the list ends, so there is **no cycle**. Return \`null\`.`,
        vars: vars(),
        phase: 'done',
      };
      return;
    }
    const s0 = slow.node;
    slow = hop(slow);
    steps++;
    yield {
      state: snap([{ from: s0, who: 'slow' }]),
      line: ['loop', 'slow'],
      note: `The hare can still move, so keep going. Tortoise crawls **one** step: node ${s0} → **${slow.node}**.`,
      vars: vars(),
      phase: 'meet',
    };
    const f0 = fast.node;
    const f1 = hop(fast);
    fast = f1.node >= 0 ? hop(f1) : f1;
    const trail: State['trail'] = [{ from: f0, who: 'fast' }];
    if (f1.node >= 0) trail.push({ from: f1.node, who: 'fast' });
    const g = fast.node >= 0 ? gapOf(slow, fast) : null;
    const met = fast.node === slow.node;
    yield {
      state: snap(trail),
      line: 'fast',
      note: met
        ? `Hare leaps **two** steps: ${f0} → ${f1.node} → **${fast.node}** — landing right on the tortoise!`
        : fast.node < 0
          ? `Hare leaps two steps: ${f0} → ${f1.node} → **null**. It fell off the end.`
          : g !== null
            ? `Hare leaps **two** steps: ${f0} → ${f1.node} → **${fast.node}**. Both are inside the loop now; the hare is **${g}** node${g === 1 ? '' : 's'} behind the tortoise and closes the gap by exactly 1 each round, so it can't jump over it.`
            : `Hare leaps **two** steps: ${f0} → ${f1.node} → **${fast.node}**. Not equal to the tortoise (${slow.node}), keep running.`,
      vars: vars(),
      phase: 'meet',
    };
    if (met) {
      meet = slow.node;
      yield {
        state: snap(),
        line: 'meet',
        note: `\`slow === fast\` at **node ${meet}** after ${steps} steps — proof that a **cycle exists**. Now: where does it start?`,
        vars: vars(),
        phase: 'meet',
      };
      break;
    }
  }

  // ---- phase 2: find the cycle start ----
  const mu = loop as number;
  slow = { node: 0, ang: Math.round(slow.ang / 360) * 360 };
  yield {
    state: snap(),
    line: 'reset',
    note: `Send the tortoise back to the **head**; the hare stays at node ${meet} but now walks **1 step** at a time. The math: the head is exactly as far from the cycle start as the meeting point is (going around the loop).`,
    vars: vars(),
    phase: 'find start',
  };
  while (slow.node !== (fast as Tok).node) {
    const s0 = slow.node;
    const f0 = (fast as Tok).node;
    slow = hop(slow);
    fast = hop(fast as Tok);
    steps++;
    const eq = slow.node === fast.node;
    yield {
      state: snap([
        { from: s0, who: 'slow' },
        { from: f0, who: 'fast' },
      ]),
      line: 'p2step',
      note: eq
        ? `Both step once: tortoise ${s0} → **${slow.node}**, hare ${f0} → **${fast.node}**. They arrive together!`
        : `Both step once: tortoise ${s0} → **${slow.node}**, hare ${f0} → **${fast.node}**. Still apart, keep walking in lock-step.`,
      vars: vars(),
      phase: 'find start',
    };
  }
  start = slow.node;
  yield {
    state: snap(),
    line: 'p2loop',
    note:
      mu === 0
        ? `The tortoise is already standing on the hare: the whole list is one loop, so the cycle starts at the **head, node 0**.`
        : `\`slow === fast\` at **node ${start}**: that's where the tail joins the loop. It took **${mu}** step${mu === 1 ? '' : 's'} = the tail length μ.`,
    vars: vars(),
    phase: 'find start',
  };

  // ---- phase 3: cycle length ----
  fast = null;
  p = hop(slow);
  len = 1;
  counted = [start];
  yield {
    state: snap([{ from: start, who: 'p' }]),
    line: 'lenInit',
    note:
      p.node === start
        ? `Bonus: the loop length. \`p = slow.next\` is node ${start} itself — a **self-loop**, so the length is 1.`
        : `Bonus: measure the loop. Park the tortoise at the start and send a marker \`p\` one step ahead to node ${p.node}; \`len = 1\`.`,
    vars: vars(),
    phase: 'length',
  };
  while (p.node !== slow.node) {
    const p0 = p.node;
    counted = [...counted, p0];
    p = hop(p);
    len++;
    yield {
      state: snap([{ from: p0, who: 'p' }]),
      line: 'lenStep',
      note: p.node === slow.node ? `\`p\` steps ${p0} → **${p.node}** — back at the tortoise. One full lap: **len = ${len}**.` : `\`p\` steps ${p0} → **${p.node}**, \`len = ${len}\`.`,
      vars: vars(),
      phase: 'length',
    };
  }
  yield {
    state: snap([], { done: true }),
    line: 'ret',
    note: `Cycle found: it starts at **node ${start}** (tail length μ = ${mu}) and has length **λ = ${len}**. Only two pointers, O(1) extra memory.`,
    vars: vars(),
    phase: 'done',
  };
}

/* ---------------- layout ---------------- */

const D = 72; // spacing
const NR = 17; // node radius
const X0 = 40;
const PAD_Y = 66;

function layout(n: number, loop: number | null) {
  const L = loop === null ? 0 : n - loop;
  const r = L === 0 ? 0 : L === 1 ? 32 : Math.max(48, (L * D) / (2 * Math.PI));
  const cy = PAD_Y + Math.max(r, 20);
  const cx = loop === null ? 0 : X0 + loop * D + r;
  const pos = (k: number): { x: number; y: number; a?: number } => {
    if (k < 0) return { x: X0 + n * D - 8, y: cy };
    if (loop === null || k < loop) return { x: X0 + k * D, y: cy };
    const a = 180 + ((k - loop) * 360) / L;
    const rad = (a * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad), a };
  };
  const W = loop === null ? X0 + n * D + 20 : cx + r + 44;
  const H = cy + Math.max(r, 20) + PAD_Y;
  return { L, r, cx, cy, pos, W, H };
}

function tokTransform(t: Tok, lay: ReturnType<typeof layout>, loop: number | null) {
  if (loop !== null && t.node >= loop) {
    return `translate(${lay.cx}px, ${lay.cy}px) rotate(${t.ang}deg) translate(${-lay.r}px, 0px) rotate(${-t.ang}deg)`;
  }
  const p = lay.pos(t.node);
  return `translate(${p.x}px, ${p.y}px) rotate(${t.ang}deg) translate(0px, 0px) rotate(${-t.ang}deg)`;
}

const WHO_TONE: Record<Who, Tone> = { slow: 'done', fast: 'swap', p: 'path' };

const STYLE = `
.floyd-cycle-tok { transform-origin: 0 0; transition: transform var(--step-ms) var(--ease-in-out), opacity var(--step-ms) ease; }
.floyd-cycle-bob { animation: floyd-cycle-bob 1.6s var(--ease-in-out) infinite alternate; }
.floyd-cycle-bob-fast { animation: floyd-cycle-bob 0.7s var(--ease-in-out) infinite alternate; }
@keyframes floyd-cycle-bob { to { transform: translateY(-2.5px); } }
.floyd-cycle-edge { transition: stroke var(--step-ms) ease, stroke-width var(--step-ms) ease, opacity var(--step-ms) ease; }
.floyd-cycle-node { transition: fill var(--step-ms) ease, stroke var(--step-ms) ease; }
.floyd-cycle-flow { stroke-dasharray: 7 6; animation: floyd-cycle-march 0.7s linear infinite; }
@keyframes floyd-cycle-march { to { stroke-dashoffset: -13; } }
.floyd-cycle-ring { transform-box: fill-box; transform-origin: center; animation: floyd-cycle-spin 5s linear infinite; }
@keyframes floyd-cycle-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .floyd-cycle-tok { transition: opacity 150ms ease; }
  .floyd-cycle-bob, .floyd-cycle-bob-fast, .floyd-cycle-flow, .floyd-cycle-ring { animation: none; }
}`;

function Tortoise() {
  return (
    <g>
      <ellipse cx={12} cy={3} rx={4.5} ry={3.8} fill="#5fd3a5" />
      <circle cx={13.5} cy={2} r={0.9} fill="#0b0f18" />
      {[-7, 5].map((x) => (
        <g key={x}>
          <rect x={x - 1.5} y={4} width={4} height={5} rx={2} fill="#3fa37c" />
        </g>
      ))}
      <path d="M-13 6 Q-12 -9 0 -9 Q12 -9 11 6 Z" fill="#5fd3a5" stroke="#0b0f18" strokeWidth={1.2} />
      <path d="M-6 5 L-4 -3 L4 -3 L6 5 M-4 -3 L-1 -8 M4 -3 L1 -8 M-10 2 L-4 -3 M10 2 L4 -3" fill="none" stroke="#1f6e52" strokeWidth={1.1} strokeLinejoin="round" />
      <path d="M-13 5 L-17 7" stroke="#3fa37c" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

function Hare() {
  return (
    <g>
      <ellipse cx={4} cy={-14} rx={2.4} ry={8} fill="#ff5fa2" stroke="#0b0f18" strokeWidth={1} transform="rotate(-12 4 -14)" />
      <ellipse cx={9} cy={-13} rx={2.4} ry={8} fill="#ff5fa2" stroke="#0b0f18" strokeWidth={1} transform="rotate(14 9 -13)" />
      <ellipse cx={-2} cy={2} rx={11} ry={7} fill="#ff5fa2" stroke="#0b0f18" strokeWidth={1.2} />
      <circle cx={8} cy={-4} r={5.5} fill="#ff5fa2" stroke="#0b0f18" strokeWidth={1.2} />
      <circle cx={10} cy={-5} r={1} fill="#0b0f18" />
      <circle cx={-13} cy={0} r={3} fill="#ece6d6" />
      <path d="M-8 8 l-4 2 M4 8 l5 1" stroke="#c9437f" strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

function Flag() {
  return (
    <g>
      <line x1={0} y1={8} x2={0} y2={-14} stroke="#ffd166" strokeWidth={2} strokeLinecap="round" />
      <path d="M0 -14 L13 -10 L0 -5 Z" fill="#ffd166" stroke="#0b0f18" strokeWidth={1} />
      <text x={5} y={-7.5} fontSize={6.5} fontWeight={700} fontFamily="var(--font-mono)" fill="#0b0f18">
        p
      </text>
    </g>
  );
}

function arrowHead(x: number, y: number, ang: number, fill: string) {
  const s = 7;
  const a1 = ang + Math.PI - 0.45;
  const a2 = ang + Math.PI + 0.45;
  return <path d={`M${x} ${y} L${x + s * Math.cos(a1)} ${y + s * Math.sin(a1)} L${x + s * Math.cos(a2)} ${y + s * Math.sin(a2)} Z`} fill={fill} />;
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const { n, loop } = s;
  const lay = layout(n, loop);
  const { L, r, cx, cy, pos, W, H } = lay;
  const trailOf = (k: number) => s.trail.find((t) => t.from === k)?.who;

  const edges = Array.from({ length: n }, (_, k) => {
    const to = k < n - 1 ? k + 1 : loop;
    const who = trailOf(k);
    const back = k === n - 1 && loop !== null;
    const col = who ? toneFill(WHO_TONE[who]) : back ? toneFill('danger') : '#4a5a80';
    const sw = who ? 3.6 : 2.2;
    let d: string;
    let head: { x: number; y: number; ang: number };
    if (to === null) {
      // into the null terminator
      const a = pos(k);
      const b = pos(-1);
      d = `M${a.x + NR} ${a.y} L${b.x - 14} ${b.y}`;
      head = { x: b.x - 14, y: b.y, ang: 0 };
    } else if (loop !== null && k >= loop) {
      // arc along the ring (clockwise on screen)
      const a0 = pos(k).a as number;
      const a1 = L === 1 ? a0 + 360 : a0 + 360 / L;
      const del = ((NR + 3) / r) * (180 / Math.PI);
      const s0 = ((a0 + del) * Math.PI) / 180;
      const e0 = ((a1 - del - 1) * Math.PI) / 180;
      const sx = cx + r * Math.cos(s0);
      const sy = cy + r * Math.sin(s0);
      const ex = cx + r * Math.cos(e0);
      const ey = cy + r * Math.sin(e0);
      const large = a1 - a0 - 2 * del > 180 ? 1 : 0;
      d = `M${sx} ${sy} A${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
      head = { x: ex, y: ey, ang: e0 + Math.PI / 2 };
    } else {
      const a = pos(k);
      const b = pos(to);
      d = `M${a.x + NR} ${a.y} L${b.x - NR - 3} ${b.y}`;
      head = { x: b.x - NR - 3, y: b.y, ang: 0 };
    }
    return (
      <g key={k}>
        <path className={`floyd-cycle-edge${who ? ' floyd-cycle-flow' : ''}`} d={d} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeDasharray={back && !who ? '6 5' : undefined} filter="url(#floyd-cycle-sketch)" />
        {arrowHead(head.x, head.y, head.ang, col)}
      </g>
    );
  });

  const nodeTone = (k: number): Tone => {
    if (k === s.start) return 'found';
    if (s.counted.includes(k)) return 'path';
    if (k === s.meet) return 'frontier';
    return 'idle';
  };

  const hide = (t: Tok | null) => !t;
  const both = s.fast && s.fast.node === s.slow.node && s.fast.node >= 0;
  const centre =
    s.len > 0 ? `len = ${s.len}` : s.gap !== null && s.meet < 0 && !s.noCycle ? `gap ${s.gap}` : s.start >= 0 ? 'start found' : s.meet >= 0 ? 'met!' : '';

  return (
    <VizStack gap={18}>
      <StatRow
        stats={[
          { label: 'tortoise at', value: s.slow.node < 0 ? 'null' : s.slow.node, tone: 'done' },
          { label: 'hare at', value: s.fast ? (s.fast.node < 0 ? 'null' : s.fast.node) : '—', tone: 'swap' },
          { label: 'steps', value: s.steps },
          { label: 'meeting node', value: s.meet < 0 ? '—' : s.meet, tone: 'frontier' },
          { label: 'cycle start', value: s.start < 0 ? '—' : s.start, tone: 'found' },
          { label: 'cycle length', value: s.len || '—', tone: 'path' },
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.35, maxHeight: 460, display: 'block', margin: '0 auto', overflow: 'visible' }} role="img" aria-label="linked list with tortoise and hare">
        <style>{STYLE}</style>
        <defs>
          <filter id="floyd-cycle-sketch" x="-5%" y="-20%" width="110%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={3} />
            <feDisplacementMap in="SourceGraphic" scale={2.2} />
          </filter>
        </defs>
        {L > 0 && (
          <circle cx={cx} cy={cy} r={r + 26} fill="none" stroke="var(--paper-faint)" strokeOpacity={0.12} strokeDasharray="2 7" className="floyd-cycle-ring" />
        )}
        {L > 1 && centre && (
          <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontFamily="var(--font-display)" fontStyle="italic" fill="var(--paper-dim)">
            {centre}
          </text>
        )}
        {edges}
        {loop === null && (
          <g transform={`translate(${pos(-1).x} ${cy})`} stroke="var(--paper-faint)" strokeWidth={2} strokeLinecap="round">
            <line x1={-8} x2={-8} y1={-12} y2={12} />
            <line x1={-2} x2={-2} y1={-8} y2={8} />
            <line x1={4} x2={4} y1={-4} y2={4} />
            <text x={-2} y={30} textAnchor="middle" stroke="none" fill="var(--paper-faint)" fontSize={11} fontFamily="var(--font-mono)">
              null
            </text>
          </g>
        )}
        {Array.from({ length: n }, (_, k) => {
          const p = pos(k);
          const t = nodeTone(k);
          return (
            <g key={k} transform={`translate(${p.x} ${p.y})`}>
              <circle className="floyd-cycle-node" r={NR} fill={t === 'idle' ? 'var(--ink-3)' : toneFill(t)} stroke={t === 'idle' ? 'var(--paper-faint)' : toneFill(t)} strokeWidth={1.6} />
              <text y={5} textAnchor="middle" fontSize={14} fontWeight={700} fontFamily="var(--font-mono)" fill={t === 'idle' ? 'var(--paper)' : toneInk(t)}>
                {k}
              </text>
              {k === 0 && (
                <text y={-NR - 38} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--paper-faint)" letterSpacing="0.1em">
                  HEAD
                </text>
              )}
            </g>
          );
        })}
        {loop !== null && loop > 0 && s.start >= 0 && (
          <g>
            <path d={`M${X0} ${cy + NR + 44} v6 H${X0 + loop * D} v-6`} fill="none" stroke={toneFill('path')} strokeWidth={1.6} strokeLinecap="round" />
            <text x={X0 + (loop * D) / 2} y={cy + NR + 66} textAnchor="middle" fontSize={12} fontFamily="var(--font-mono)" fill={toneFill('path')}>
              tail μ = {loop}
            </text>
          </g>
        )}
        {/* tokens */}
        <g className="floyd-cycle-tok" style={{ transform: tokTransform(s.slow, lay, loop), opacity: 1 }}>
          <g transform={`translate(${both ? -10 : 0} -36)`}>
            <g className="floyd-cycle-bob">
              <Tortoise />
            </g>
          </g>
        </g>
        <g className="floyd-cycle-tok" style={{ transform: tokTransform(s.fast ?? s.slow, lay, loop), opacity: hide(s.fast) ? 0 : 1 }}>
          <g transform={`translate(${both ? 8 : 0} 40)`}>
            <g className="floyd-cycle-bob-fast">
              <Hare />
            </g>
          </g>
        </g>
        <g className="floyd-cycle-tok" style={{ transform: tokTransform(s.p ?? s.slow, lay, loop), opacity: s.p ? 1 : 0 }}>
          <g transform="translate(0 38)">
            <Flag />
          </g>
        </g>
      </svg>
      <Callout show={s.done} tone={s.noCycle ? 'danger' : 'found'}>
        {s.noCycle ? 'no cycle — the hare hit null' : `cycle starts at node ${s.start} · length ${s.len}`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const ring = 'M60 40 a18 18 0 1 1 36 0 a18 18 0 1 1 -36 0';
  return (
    <svg viewBox="0 0 120 80">
      <line x1={10} y1={40} x2={60} y2={40} stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" />
      <circle cx={78} cy={40} r={18} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} />
      {[10, 27, 44].map((x) => (
        <circle key={x} cx={x} cy={40} r={4} fill="currentColor" />
      ))}
      <circle cx={60} cy={40} r={4.5} fill="currentColor">
        <animate attributeName="fill" values="#c6f36b;#c6f36b;#ffd166" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle r={4} fill="#5fd3a5">
        <animateMotion dur="4s" repeatCount="indefinite" path={ring} />
      </circle>
      <circle r={3.5} fill="#ff5fa2">
        <animateMotion dur="2s" repeatCount="indefinite" path={ring} />
      </circle>
    </svg>
  );
}

function parse(text: string): Input {
  const [a, b] = text.split('|').map((t) => t.trim());
  if (!a) throw new Error('Write the list length, e.g. "10 | 3".');
  const n = Number(a);
  if (!Number.isInteger(n)) throw new Error(`"${a}" isn't a whole number of nodes.`);
  if (n < 3 || n > 14) throw new Error('Use between 3 and 14 nodes so the picture stays readable.');
  if (b === undefined || b === '' || b === '-' || /^none$/i.test(b) || /^null$/i.test(b)) {
    if (b === undefined) throw new Error('Add where the tail points after a "|": a node index, or "none" for no cycle.');
    return { n, loop: null };
  }
  const loop = Number(b);
  if (!Number.isInteger(loop)) throw new Error(`"${b}" should be a node index (0–${n - 1}) or "none".`);
  if (loop < 0 || loop > n - 1) throw new Error(`The tail can only link to an existing node: 0–${n - 1}.`);
  return { n, loop };
}

export default defineAlgorithm<Input, State>({
  id: 'floyd-cycle',
  name: "Floyd's Cycle Detection",
  category: 'arrays',
  order: 2,
  tagline: 'Tortoise and hare: a slow and a fast pointer expose a loop in O(1) memory.',
  description:
    "Does a linked list loop back on itself? Walk two pointers from the head — a **tortoise** moving 1 node per step and a **hare** moving 2. If the list ends, the hare finds `null`; if there is a cycle, the hare gets trapped and must eventually land on the tortoise. A second, clever walk then pinpoints exactly **where** the loop begins.",
  howItWorks: [
    'Phase 1: move `slow` by 1 and `fast` by 2 until they meet (cycle) or `fast` hits `null` (no cycle).',
    'Inside the loop the hare gains exactly one node per round, so it can never skip past the tortoise.',
    'Phase 2: reset `slow` to the head and move both by 1 — they meet at the **cycle start**, because head→start equals meeting point→start (mod the loop length).',
    'Phase 3 (bonus): hold one pointer still and walk the other around once to count the **cycle length**.',
  ],
  complexity: { time: 'O(n)', space: 'O(1)', note: 'The tortoise enters the loop within μ steps and is caught within λ more, so phase 1 takes < n rounds.' },
  code: {
    js: `
function detectCycle(head) { //@fn
  let slow = head, fast = head; //@init
  while (fast && fast.next) { //@loop
    slow = slow.next; //@slow
    fast = fast.next.next; //@fast
    if (slow === fast) break; //@meet
  }
  if (!fast || !fast.next) return null; //@none
  slow = head; //@reset
  while (slow !== fast) { //@p2loop
    slow = slow.next; fast = fast.next; //@p2step
  }
  let len = 1, p = slow.next; //@lenInit
  while (p !== slow) { p = p.next; len++; } //@lenStep
  return { start: slow, len }; //@ret
}`,
    py: `
def detect_cycle(head): #@fn
    slow = fast = head #@init
    while fast and fast.next: #@loop
        slow = slow.next #@slow
        fast = fast.next.next #@fast
        if slow is fast: break #@meet
    if not fast or not fast.next: return None #@none
    slow = head #@reset
    while slow is not fast: #@p2loop
        slow, fast = slow.next, fast.next #@p2step
    length, p = 1, slow.next #@lenInit
    while p is not slow: p, length = p.next, length + 1 #@lenStep
    return slow, length #@ret`,
  },
  input: {
    default: { n: 12, loop: 4 },
    presets: [
      { name: 'Classic rho (10 → 3)', value: { n: 10, loop: 3 } },
      { name: 'No cycle', value: { n: 8, loop: null } },
      { name: 'Whole list is a loop', value: { n: 9, loop: 0 } },
      { name: 'Self-loop at the tail', value: { n: 6, loop: 5 } },
      { name: 'Long tail, tiny loop', value: { n: 14, loop: 11 } },
    ],
    random: () => {
      const n = randInt(5, 14);
      return { n, loop: Math.random() < 0.2 ? null : randInt(0, n - 1) };
    },
    format: (v) => `${v.n} | ${v.loop === null ? 'none' : v.loop}`,
    parse,
    placeholder: '10 | 3',
    hint: 'Nodes (3–14), then "|" and the node index the tail links back to — or "none" / "-" for no cycle.',
  },
  run,
  View,
  legend: [
    { tone: 'done', label: 'tortoise (1 step)' },
    { tone: 'swap', label: 'hare (2 steps)' },
    { tone: 'danger', label: 'back edge (tail → loop)' },
    { tone: 'frontier', label: 'meeting point' },
    { tone: 'found', label: 'cycle start' },
    { tone: 'path', label: 'marker p / loop counted' },
  ],
  Glyph,
});
