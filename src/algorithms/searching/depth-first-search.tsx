import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import {
  adjacency,
  Callout,
  ek,
  GraphView,
  makeGraphEditor,
  randomGraph,
  StatRow,
  TokenStrip,
  toneFill,
  toneInk,
  VizRow,
  VizSection,
  VizStack,
  type Graph,
  type Traveler,
} from '@/viz';

type Look = { from: string; to: string; kind: 'new' | 'parent' | 'back' | 'seen' };

interface Call {
  u: string;
  parent: string | null;
  nbrs: string[];
  i: number; // index of the neighbour being examined (-1 = loop not started)
  ret?: boolean; // finishing, about to be popped
}

interface State {
  stack: Call[];
  disc: Record<string, number>;
  fin: Record<string, number>;
  order: string[];
  finOrder: string[];
  tree: string[]; // ek keys
  skipped: string[]; // non-tree edges already examined
  look: Look | null;
  travel: Traveler | null;
  backEdges: number;
  done: boolean;
  unreached: string[];
}

function* run(g: Graph): Generator<Frame<State>> {
  const ids = g.nodes.map((n) => n.id);
  const empty: State = { stack: [], disc: {}, fin: {}, order: [], finOrder: [], tree: [], skipped: [], look: null, travel: null, backEdges: 0, done: false, unreached: [] };
  if (!ids.length) {
    yield { state: empty, line: 'fn', note: 'The graph is empty — add a few nodes and edges in the editor to explore.', phase: 'setup' };
    yield { state: { ...empty, done: true }, line: 'done', note: 'Nothing to visit, so the visit order is empty.', phase: 'done' };
    return;
  }
  const start = g.source && ids.includes(g.source) ? g.source : ids[0];
  const adj = adjacency(g, false);
  const nb = (u: string) => (adj.get(u) ?? []).map((e) => e.to);

  const stack: Call[] = [];
  const disc: Record<string, number> = {};
  const fin: Record<string, number> = {};
  const order: string[] = [];
  const finOrder: string[] = [];
  const tree: string[] = [];
  const skipped: string[] = [];
  let clock = 0;
  let backEdges = 0;

  const S = (o: Partial<State> = {}): State => ({
    stack: stack.map((c) => ({ ...c, nbrs: [...c.nbrs] })),
    disc: { ...disc },
    fin: { ...fin },
    order: [...order],
    finOrder: [...finOrder],
    tree: [...tree],
    skipped: [...skipped],
    look: null,
    travel: null,
    backEdges,
    done: false,
    unreached: [],
    ...o,
  });
  const V = (u?: string, v?: string) => ({ u, v, time: clock, depth: stack.length, order: [...order] });

  yield {
    state: S(),
    line: ['fn', 'init'],
    note: `Depth-first search from **${start}**: always dive into the **first unvisited neighbour**, and only back up when a node has nothing new left. The recursion's call stack remembers the way back.`,
    vars: V(),
    phase: 'setup',
  };

  stack.push({ u: start, parent: null, nbrs: nb(start), i: -1 });
  yield {
    state: S(),
    line: 'start',
    note: `Call \`visit(${start})\` — the first frame goes onto the call stack.`,
    vars: V(start),
    phase: 'explore',
  };

  function* visit(u: string, parent: string | null): Generator<Frame<State>> {
    clock++;
    disc[u] = clock;
    order.push(u);
    const call = stack[stack.length - 1];
    yield {
      state: S(),
      line: 'enter',
      note:
        parent === null
          ? `Mark **${u}** visited (discovered at time **${clock}**). Its neighbours, in order: ${call.nbrs.length ? call.nbrs.join(', ') : 'none'}.`
          : `Arrived at **${u}** — mark it visited at time **${clock}**. We're now **${stack.length}** calls deep; ${call.nbrs.length} neighbour${call.nbrs.length === 1 ? '' : 's'} to try.`,
      vars: V(u),
      phase: 'explore',
    };
    for (let i = 0; i < call.nbrs.length; i++) {
      const v = call.nbrs[i];
      call.i = i;
      const key = ek(u, v);
      const onStack = stack.some((c) => c.u === v);
      const kind: Look['kind'] = !(v in disc) ? 'new' : v === parent ? 'parent' : onStack ? 'back' : 'seen';
      const note =
        kind === 'new'
          ? `Look at neighbour **${v}** of ${u}: not visited yet, so we'll dive into it right away.`
          : kind === 'parent'
            ? `Neighbour **${v}** is where we just came from (${u}'s parent) — already visited, skip.`
            : kind === 'back'
              ? `Neighbour **${v}** is visited and still on the call stack — this edge loops back to an ancestor, so the graph has a **cycle**. Skip it.`
              : `Neighbour **${v}** is already finished — we crossed this edge from the other side. Skip.`;
      yield {
        state: S({ look: { from: u, to: v, kind }, travel: { from: u, to: v, tone: kind === 'new' ? 'active' : 'compare' } }),
        line: 'check',
        note,
        vars: V(u, v),
        phase: 'explore',
      };
      if (kind === 'new') {
        tree.push(key);
        stack.push({ u: v, parent: u, nbrs: nb(v), i: -1 });
        yield {
          state: S({ travel: { from: u, to: v, tone: 'active' } }),
          line: 'recurse',
          note: `Recurse: call \`visit(${v})\`. ${u}'s frame is **paused** at neighbour ${v} — it will resume here once ${v} is completely explored.`,
          vars: V(u, v),
          phase: 'explore',
        };
        yield* visit(v, u);
      } else {
        if (!tree.includes(key) && !tree.includes(ek(v, u)) && !skipped.includes(key) && !skipped.includes(ek(v, u))) {
          skipped.push(key);
          if (kind === 'back') backEdges++;
        }
      }
    }
    clock++;
    fin[u] = clock;
    finOrder.push(u);
    call.ret = true;
    yield {
      state: S({ travel: parent ? { from: u, to: parent, tone: 'done' } : null }),
      line: 'finish',
      note: parent
        ? `Every neighbour of **${u}** is handled, so ${u} is **finished** (time ${clock}). Return — backtrack to **${parent}** and resume its loop.`
        : `Every neighbour of **${u}** is handled — ${u} is finished (time ${clock}) and the last frame leaves the call stack.`,
      vars: V(u),
      phase: 'backtrack',
    };
    stack.pop();
  }

  yield* visit(start, null);

  const unreached = ids.filter((id) => !(id in disc));
  yield {
    state: S({ done: true, unreached }),
    line: 'done',
    note: `DFS done: visited **${order.length}** node${order.length === 1 ? '' : 's'} in the order ${order.join(' → ')}.${
      unreached.length ? ` ${unreached.join(', ')} can't be reached from ${start}.` : ''
    }${backEdges ? ` Found ${backEdges} back edge${backEdges === 1 ? '' : 's'} (cycles).` : ' No back edges — the explored part is a tree.'}`,
    vars: { ...V(), u: undefined, v: undefined },
    phase: 'done',
  };
}

/* ---------- call stack panel ---------- */

function CallStack({ stack, capacity }: { stack: Call[]; capacity: number }) {
  const W = 250;
  const rowH = 44;
  const rows = Math.max(4, capacity);
  const H = 18 + rows * rowH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxHeight: 460, overflow: 'visible' }} aria-label="call stack">
      <style>{`
        .depth-first-search-frame { animation: depth-first-search-push var(--step-ms) var(--ease-out); }
        .depth-first-search-frame rect { transition: fill var(--step-ms) ease, stroke var(--step-ms) ease; }
        .depth-first-search-chip { transition: fill var(--step-ms) ease; }
        @keyframes depth-first-search-push { from { opacity: 0; transform: translateY(-14px); } }
        @media (prefers-reduced-motion: reduce) { .depth-first-search-frame { animation: none; } }
      `}</style>
      {/* the "tray" the frames sit in, sketched */}
      <path
        d={`M6 8 Q5 ${H / 2} 7 ${H - 6} Q${W / 2} ${H - 3} ${W - 7} ${H - 6} Q${W - 5} ${H / 2} ${W - 6} 8`}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {stack.length === 0 && (
        <text x={W / 2} y={H - 22} textAnchor="middle" style={{ font: 'italic 12px var(--font-ui)', fill: 'var(--paper-faint)' }}>
          empty
        </text>
      )}
      {stack.map((c, d) => {
        const top = d === stack.length - 1;
        const y = H - 10 - (d + 1) * rowH;
        const tone: Tone = c.ret ? 'done' : top ? 'active' : 'frontier';
        const chipW = Math.min(20, 128 / Math.max(1, c.nbrs.length));
        return (
          <g key={`${d}-${c.u}`} className="depth-first-search-frame" style={{ transform: `translate(0px, ${y}px)` }}>
            <rect x={14} y={4} width={W - 28} height={rowH - 8} rx={9} fill={top ? 'var(--ink-3)' : 'var(--ink-2)'} stroke={toneFill(tone)} strokeWidth={top ? 2.2 : 1.3} />
            <rect x={14} y={4} width={6} height={rowH - 8} rx={3} fill={toneFill(tone)} />
            <text x={28} y={rowH / 2 + 4.5} style={{ font: '700 13px var(--font-mono)', fill: 'var(--paper)' }}>
              visit({c.u})
            </text>
            {c.ret ? (
              <text x={W - 24} y={rowH / 2 + 4.5} textAnchor="end" style={{ font: '700 11.5px var(--font-mono)', fill: toneFill('done') }}>
                return ✓
              </text>
            ) : (
              c.nbrs.map((v, k) => {
                const t: Tone = k < c.i ? 'muted' : k === c.i ? (top ? 'compare' : 'path') : 'idle';
                const cx = W - 24 - (c.nbrs.length - 1 - k) * chipW - chipW / 2 + 2;
                return (
                  <g key={v}>
                    <rect className="depth-first-search-chip" x={cx - chipW / 2 + 1} y={rowH / 2 - 9} width={chipW - 2} height={18} rx={5} fill={toneFill(t)} stroke={t === 'idle' ? 'var(--line-strong)' : 'none'} />
                    <text x={cx} y={rowH / 2 + 4} textAnchor="middle" style={{ font: `700 ${chipW < 16 ? 9 : 11}px var(--font-mono)`, fill: toneInk(t) }}>
                      {v}
                    </text>
                  </g>
                );
              })
            )}
          </g>
        );
      })}
      {stack.length > 0 && (
        <text x={W - 16} y={H - 10 - stack.length * rowH - 1} textAnchor="end" style={{ font: '600 10px var(--font-mono)', fill: 'var(--paper-faint)', letterSpacing: '0.1em' }}>
          ▼ TOP
        </text>
      )}
    </svg>
  );
}

function View({ frame, input }: { frame: Frame<State>; input: Graph }) {
  const s = frame.state;
  const top = s.stack[s.stack.length - 1];
  const onStack = new Set(s.stack.map((c) => c.u));
  const nodeTones: Record<string, Tone | undefined> = {};
  const badges: Record<string, string | undefined> = {};
  const badgeTones: Record<string, Tone | undefined> = {};
  for (const n of input.nodes) {
    const id = n.id;
    if (id in s.fin) nodeTones[id] = 'done';
    else if (top && id === top.u && id in s.disc) nodeTones[id] = 'active';
    else if (id in s.disc) nodeTones[id] = 'frontier';
    else if (s.unreached.includes(id)) nodeTones[id] = 'muted';
    if (id in s.disc) {
      badges[id] = `${s.disc[id]}/${s.fin[id] ?? '·'}`;
      badgeTones[id] = id in s.fin ? 'done' : 'frontier';
    }
  }
  const edgeTones: Record<string, Tone | undefined> = {};
  for (const k of s.skipped) edgeTones[k] = 'muted';
  for (const k of s.tree) edgeTones[k] = 'path';
  if (s.look) edgeTones[ek(s.look.from, s.look.to)] = s.look.kind === 'new' ? 'active' : 'compare';
  const rings: Record<string, Tone | undefined> = {};
  if (top && !top.ret) rings[top.u] = 'active';
  if (s.look && s.look.kind !== 'new') rings[s.look.to] = s.look.kind === 'back' ? 'danger' : 'compare';
  const subs: Record<string, string | undefined> = {};
  if (s.look) subs[s.look.to] = s.look.kind === 'new' ? 'unvisited' : s.look.kind === 'parent' ? 'parent' : s.look.kind === 'back' ? 'on stack ⟲' : 'finished';

  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'visited', value: `${s.order.length}/${input.nodes.length}`, tone: 'frontier' },
          { label: 'finished', value: s.finOrder.length, tone: 'done' },
          { label: 'stack depth', value: s.stack.length, tone: 'active' },
          { label: 'back edges (cycles)', value: s.backEdges, tone: s.backEdges ? 'danger' : undefined },
        ]}
      />
      <VizRow gap={16}>
        <div style={{ flex: '3 1 420px' }}>
          <GraphView
            nodes={input.nodes}
            edges={input.edges}
            nodeTones={nodeTones}
            edgeTones={edgeTones}
            nodeBadges={badges}
            badgeTones={badgeTones}
            rings={rings}
            nodeSubs={subs}
            travelers={s.travel ? [s.travel] : []}
          />
        </div>
        <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
          <VizSection label="call stack" aside={top ? `in visit(${top.u})` : undefined}>
            <CallStack stack={s.stack} capacity={input.nodes.length} />
          </VizSection>
        </div>
      </VizRow>
      <TokenStrip label="visit" items={s.order.map((id, k) => ({ id, text: `${k + 1}·${id}`, tone: id in s.fin ? 'done' : onStack.has(id) ? 'frontier' : 'visited' }))} empty="nothing visited yet" />
      <TokenStrip label="finish" items={s.finOrder.map((id) => ({ id, text: id, tone: 'done' as Tone }))} empty="no node finished yet" />
      <Callout show={s.done} tone={s.unreached.length ? 'active' : 'found'}>
        {s.order.length ? s.order.join(' → ') : 'empty graph'}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const P = { r: [60, 14], a: [32, 40], b: [88, 40], c: [18, 66], d: [46, 66], e: [88, 66] } as const;
  const route = 'M60 14 L32 40 L18 66 L32 40 L46 66 L32 40 L60 14 L88 40 L88 66';
  // arrival times (fraction of the loop) — the dot moves at constant speed over the first 90%
  const arrive: Record<string, number> = { r: 0, a: 0.133, c: 0.236, d: 0.441, b: 0.809, e: 0.9 };
  const edges: [keyof typeof P, keyof typeof P][] = [['r', 'a'], ['r', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'e']];
  return (
    <svg viewBox="0 0 120 80">
      {edges.map(([u, v]) => (
        <line key={u + v} x1={P[u][0]} y1={P[u][1]} x2={P[v][0]} y2={P[v][1]} stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} />
      ))}
      {(Object.keys(P) as (keyof typeof P)[]).map((k) => {
        const t = Math.max(0.001, arrive[k]);
        return (
          <circle key={k} cx={P[k][0]} cy={P[k][1]} r={6.5} fill="#1b2539" stroke="currentColor" strokeWidth={1.5}>
            <animate attributeName="fill" values="#1b2539;#1b2539;#a98bff;#5fd3a5;#1b2539" keyTimes={`0;${t};${Math.min(0.97, t + 0.01)};0.98;1`} dur="5s" repeatCount="indefinite" calcMode="discrete" />
          </circle>
        );
      })}
      <circle r={3.5} fill="#f5b544">
        <animateMotion path={route} dur="5s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.9;1" calcMode="linear" />
      </circle>
      {/* mini call stack */}
      {[0, 1, 2].map((k) => (
        <rect key={k} x={104} y={62 - k * 10} width={12} height={8} rx={2} fill="currentColor" opacity={0}>
          <animate attributeName="opacity" values={k === 0 ? '0.8;0.8' : k === 1 ? '0;0.8;0.8;0;0.8;0' : '0;0;0.8;0;0;0'} keyTimes={k === 0 ? '0;1' : '0;0.12;0.3;0.55;0.8;1'} dur="5s" repeatCount="indefinite" calcMode="discrete" />
        </rect>
      ))}
    </svg>
  );
}

const DEFAULT: Graph = {
  nodes: [
    { id: 'A', x: 400, y: 60 },
    { id: 'B', x: 220, y: 160 },
    { id: 'C', x: 590, y: 160 },
    { id: 'D', x: 100, y: 310 },
    { id: 'E', x: 300, y: 320 },
    { id: 'F', x: 500, y: 320 },
    { id: 'G', x: 700, y: 310 },
    { id: 'H', x: 400, y: 410 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'A', to: 'C', w: 1 },
    { from: 'B', to: 'D', w: 1 },
    { from: 'B', to: 'E', w: 1 },
    { from: 'D', to: 'E', w: 1 },
    { from: 'E', to: 'H', w: 1 },
    { from: 'F', to: 'H', w: 1 },
    { from: 'C', to: 'F', w: 1 },
    { from: 'C', to: 'G', w: 1 },
  ],
  source: 'A',
  target: 'H',
};

const TREE: Graph = {
  nodes: [
    { id: 'A', x: 400, y: 60 },
    { id: 'B', x: 230, y: 180 },
    { id: 'C', x: 570, y: 180 },
    { id: 'D', x: 130, y: 330 },
    { id: 'E', x: 320, y: 330 },
    { id: 'F', x: 480, y: 330 },
    { id: 'G', x: 670, y: 330 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'A', to: 'C', w: 1 },
    { from: 'B', to: 'D', w: 1 },
    { from: 'B', to: 'E', w: 1 },
    { from: 'C', to: 'F', w: 1 },
    { from: 'C', to: 'G', w: 1 },
  ],
  source: 'A',
  target: 'G',
};

const TWO_PARTS: Graph = {
  nodes: [
    { id: 'A', x: 140, y: 120 },
    { id: 'B', x: 320, y: 90 },
    { id: 'C', x: 240, y: 300 },
    { id: 'D', x: 540, y: 140 },
    { id: 'E', x: 700, y: 260 },
    { id: 'F', x: 520, y: 360 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'B', to: 'C', w: 1 },
    { from: 'C', to: 'A', w: 1 },
    { from: 'D', to: 'E', w: 1 },
    { from: 'E', to: 'F', w: 1 },
  ],
  source: 'A',
  target: 'F',
};

const LINE: Graph = {
  nodes: ['A', 'B', 'C', 'D', 'E'].map((id, i) => ({ id, x: 120 + i * 140, y: 230 + (i % 2 ? -60 : 60) })),
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'B', to: 'C', w: 1 },
    { from: 'C', to: 'D', w: 1 },
    { from: 'D', to: 'E', w: 1 },
  ],
  source: 'C',
  target: 'E',
};

export default defineAlgorithm<Graph, State>({
  id: 'depth-first-search',
  name: 'Depth-First Search',
  category: 'searching',
  order: 3,
  tagline: 'Dive as deep as you can down one path, then backtrack and try the next.',
  description:
    'DFS explores a graph like a maze-walker with a ball of string: from each node it immediately follows the **first unvisited neighbour**, going deeper and deeper. When a node has no new neighbours it is **finished** and the search backtracks. The recursion\'s **call stack** is exactly the string leading back home.',
  howItWorks: [
    'Call `visit(start)`: mark the node visited and note its discovery time.',
    'For each neighbour: if it is unvisited, recurse into it right away (the current call pauses).',
    'Visited neighbours are skipped — one that is still on the call stack (not the parent) reveals a **cycle**.',
    'When all neighbours are done the node is finished; the call returns and its caller resumes.',
  ],
  complexity: { time: 'O(V + E)', space: 'O(V)', note: 'Each node is visited once and each edge examined twice (once per end). The call stack can grow to V frames on a long path.' },
  code: {
    js: `
function dfs(graph, start) { //@fn
  const visited = new Set(), order = []; //@init
  function visit(u) {
    visited.add(u); //@enter
    order.push(u);
    for (const v of graph[u]) {
      if (!visited.has(v)) { //@check
        visit(v); //@recurse
      }
    }
  } // u is finished: return to caller //@finish
  visit(start); //@start
  return order; //@done
}`,
    py: `
def dfs(graph, start): #@fn
    visited, order = set(), [] #@init
    def visit(u):
        visited.add(u) #@enter
        order.append(u)
        for v in graph[u]:
            if v not in visited: #@check
                visit(v) #@recurse
        # u is finished: return to caller #@finish
    visit(start) #@start
    return order #@done`,
  },
  input: {
    default: DEFAULT,
    presets: [
      { name: 'Two cycles', value: DEFAULT },
      { name: 'Binary tree (no cycles)', value: TREE },
      { name: 'Disconnected pieces', value: TWO_PARTS },
      { name: 'Path, start in middle', value: LINE },
    ],
    random: () => randomGraph({ n: randInt(6, 9), weighted: false, density: 0.45 }),
    Editor: makeGraphEditor({ directed: false, weighted: false, pickSource: true, random: { weighted: false, density: 0.45 } }),
    hint: 'Drag to move, Connect to add edges, Start to choose where DFS begins. Neighbours are tried in alphabetical order.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current call' },
    { tone: 'frontier', label: 'on call stack' },
    { tone: 'done', label: 'finished' },
    { tone: 'path', label: 'tree edge' },
    { tone: 'compare', label: 'edge being checked' },
    { tone: 'muted', label: 'skipped edge' },
  ],
  Glyph,
});
