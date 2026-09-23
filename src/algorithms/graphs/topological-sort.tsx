import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { Callout, GRAPH_W, GraphView, makeGraphEditor, randomGraph, StatRow, TokenStrip, VizStack, adjacency, ek, type GNode, type Graph } from '@/viz';

type Stage = 'count' | 'seed' | 'run' | 'cycle' | 'done' | 'line' | 'arcs';

interface State {
  nodes: GNode[]; // positions — change in the final "line up" frames so nodes glide
  indeg: Record<string, number>;
  showDeg: boolean;
  removed: string[]; // edge keys already "used up"
  queue: string[];
  order: string[];
  cur: string | null; // node being processed
  edge: [string, string] | null; // edge being looked at
  fresh: string | null; // node that just became free
  stuck: string[]; // nodes left over when a cycle blocks progress
  stage: Stage;
}

/** Friendly names for the preset graphs; only shown when every node of the graph has one. */
const NAMES: Record<string, string> = {
  Und: 'underwear',
  Pnt: 'pants',
  Blt: 'belt',
  Sh: 'shirt',
  Tie: 'tie',
  Jkt: 'jacket',
  Sck: 'socks',
  Sho: 'shoes',
  Wch: 'watch',
  CS1: 'intro prog',
  CS2: 'OOP',
  DS: 'data structs',
  ALG: 'algorithms',
  OS: 'op systems',
  DB: 'databases',
  LA: 'linear alg',
  ML: 'machine lrn',
  AI: 'AI',
};
const hasNames = (g: Graph) => g.nodes.length > 0 && g.nodes.every((n) => NAMES[n.id]);

const LINE_Y = 350;
function lineLayout(order: string[], nodes: GNode[]): GNode[] {
  const n = order.length;
  const step = (GRAPH_W - 90) / Math.max(1, n);
  const pos = new Map(order.map((id, i) => [id, i]));
  return nodes.map((nd) => ({ id: nd.id, x: Math.round(45 + step * ((pos.get(nd.id) ?? 0) + 0.5)), y: LINE_Y }));
}

function* run(g: Graph): Generator<Frame<State>> {
  const ids = g.nodes.map((n) => n.id);
  const named = hasNames(g);
  const nm = (id: string) => (named ? `**${id}** (${NAMES[id]})` : `**${id}**`);
  const adj = adjacency(g, true);
  const indeg: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const removed: string[] = [];
  const queue: string[] = [];
  const order: string[] = [];
  let showDeg = false;
  let nodes = g.nodes.map((n) => ({ ...n }));

  const snap = (stage: Stage, cur: string | null = null, edge: [string, string] | null = null, fresh: string | null = null, stuck: string[] = []): State => ({
    nodes: nodes.map((n) => ({ ...n })),
    indeg: { ...indeg },
    showDeg,
    removed: [...removed],
    queue: [...queue],
    order: [...order],
    cur,
    edge,
    fresh,
    stuck: [...stuck],
    stage,
  });
  const vars = (u?: string, v?: string) => ({ u, v, 'indeg[v]': v ? indeg[v] : undefined, queue: [...queue], order: [...order] });

  if (ids.length === 0) {
    yield { state: snap('done'), line: 'done', note: 'The graph is empty — the empty order is (trivially) a valid topological order. Add some nodes and arrows!', vars: vars(), phase: 'done' };
    return;
  }

  yield {
    state: snap('count'),
    line: 'fn',
    note: `${ids.length} tasks, ${g.edges.length} "must come before" arrows. Goal: list every node so that each arrow points **forward** in the list. Kahn's idea: repeatedly pick something that nothing else is waiting on.`,
    vars: vars(),
    phase: 'count in-degrees',
  };

  showDeg = true;
  yield {
    state: snap('count'),
    line: 'init',
    note: 'Give every node an **in-degree** counter (the badge) = how many arrows point *into* it, i.e. how many things must happen first. Start them all at **0**.',
    vars: vars(),
    phase: 'count in-degrees',
  };

  for (const e of g.edges) {
    indeg[e.to]++;
    yield {
      state: snap('count', e.to, [e.from, e.to]),
      line: 'count',
      note: `Arrow ${e.from} → ${e.to}: ${nm(e.to)} has to wait for ${nm(e.from)}, so its in-degree rises to **${indeg[e.to]}**.`,
      vars: vars(e.from, e.to),
      phase: 'count in-degrees',
    };
  }

  for (const id of ids) if (indeg[id] === 0) queue.push(id);
  yield {
    state: snap('seed'),
    line: 'seed',
    note: queue.length
      ? `Nodes with in-degree **0** have no prerequisites — they can go first. Queue: **${queue.join(', ')}**.`
      : 'Not a single node has in-degree 0 — every node waits on another. That already means there is a **cycle**.',
    vars: vars(),
    phase: 'process queue',
  };

  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    const outs = adj.get(u) ?? [];
    yield {
      state: snap('run', u),
      line: ['pop', 'emit'],
      note: `Take ${nm(u)} from the front of the queue and write it as #**${order.length}** in the order — all of its prerequisites are already placed. ${outs.length ? `Now it can release its ${outs.length} outgoing arrow${outs.length > 1 ? 's' : ''}.` : 'It has no outgoing arrows.'}`,
      vars: vars(u),
      phase: 'process queue',
    };
    for (const { to: v } of outs) {
      indeg[v]--;
      removed.push(ek(u, v));
      const free = indeg[v] === 0;
      yield {
        state: snap('run', u, [u, v]),
        line: ['scan', 'dec'],
        note: free
          ? `Remove arrow ${u} → ${v}: ${nm(v)}'s in-degree drops to **0** — nothing is holding it back any more.`
          : `Remove arrow ${u} → ${v}: ${nm(v)}'s in-degree drops to **${indeg[v]}** — it still waits on ${indeg[v]} more.`,
        vars: vars(u, v),
        phase: 'process queue',
      };
      if (free) {
        queue.push(v);
        yield {
          state: snap('run', u, null, v),
          line: 'push',
          note: `${nm(v)} joins the back of the queue. Queue is now **${queue.join(', ')}**.`,
          vars: vars(u, v),
          phase: 'process queue',
        };
      }
    }
  }

  if (order.length < ids.length) {
    const stuck = ids.filter((id) => !order.includes(id));
    yield {
      state: snap('cycle', null, null, null, stuck),
      line: 'cycle',
      note: `The queue is empty but only **${order.length} of ${ids.length}** nodes are placed. The rest (**${stuck.join(', ')}**) never reached in-degree 0: they sit on a **cycle** (or wait behind one), each waiting for another to go first — so no valid order exists.`,
      vars: vars(),
      phase: 'cycle!',
    };
    return;
  }

  yield {
    state: snap('done'),
    line: 'done',
    note: `All **${ids.length}** nodes placed: **${order.join(' → ')}**. Every arrow was removed only after its tail was written, so every arrow points forward.`,
    vars: vars(),
    phase: 'result',
  };
  nodes = lineLayout(order, nodes);
  yield {
    state: snap('line'),
    line: 'done',
    note: "Let's prove it: slide the nodes into one row in that order…",
    vars: vars(),
    phase: 'result',
  };
  yield {
    state: snap('arcs'),
    line: 'done',
    note: '…and redraw the original arrows. **Every single arrow points to the right** — that is exactly what a topological order means.',
    vars: vars(),
    phase: 'result',
  };
}

/** Hand-drawn arcs over the line layout: all original edges, flowing left → right. */
function Arcs({ nodes, edges, order }: { nodes: GNode[]; edges: Graph['edges']; order: string[] }) {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const idx = new Map(order.map((id, i) => [id, i]));
  return (
    <g pointerEvents="none">
      <defs>
        <filter id="topological-sort-rough" x="-5%" y="-20%" width="110%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
      </defs>
      <style>{`
        .topological-sort-arc { fill: none; stroke: var(--t-done); stroke-width: 2.6; stroke-linecap: round;
          stroke-dasharray: 1; stroke-dashoffset: 1; animation: topological-sort-draw calc(var(--step-ms) * 1.6) var(--ease-in-out) forwards; }
        .topological-sort-head { fill: var(--t-done); opacity: 0; animation: topological-sort-fade 200ms var(--ease-out) forwards; }
        @keyframes topological-sort-draw { to { stroke-dashoffset: 0; } }
        @keyframes topological-sort-fade { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .topological-sort-arc, .topological-sort-head { animation-duration: 1ms; animation-delay: 0ms !important; } }
      `}</style>
      <g filter="url(#topological-sort-rough)">
        {edges.map((e, k) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const h = Math.min(250, 36 + Math.abs(dx) * 0.42);
          const y0 = LINE_Y - 20;
          const x1 = a.x + 6;
          const x2 = b.x - 6;
          const c1x = x1 + dx * 0.12;
          const c2x = x2 - dx * 0.28;
          const d = `M${x1} ${y0} C${c1x} ${y0 - h} ${c2x} ${y0 - h} ${x2} ${y0 - 4}`;
          const ang = (Math.atan2(y0 - 4 - (y0 - h), x2 - c2x) * 180) / Math.PI;
          const delay = ((idx.get(e.from) ?? 0) * 0.12 + k * 0.03).toFixed(2);
          return (
            <g key={ek(e.from, e.to)}>
              <path className="topological-sort-arc" d={d} pathLength={1} style={{ animationDelay: `calc(var(--step-ms) * ${delay})` }} />
              <path
                className="topological-sort-head"
                d="M0 0 L-12 -6 L-12 6 Z"
                transform={`translate(${x2} ${y0 - 4}) rotate(${ang})`}
                style={{ animationDelay: `calc(var(--step-ms) * (${delay} + 1.4))` }}
              />
            </g>
          );
        })}
      </g>
      <line x1={30} x2={GRAPH_W - 30} y1={LINE_Y + 42} y2={LINE_Y + 42} stroke="var(--paper-faint)" strokeDasharray="2 6" strokeLinecap="round" />
      <text x={GRAPH_W - 30} y={LINE_Y + 62} textAnchor="end" fill="var(--paper-faint)" fontFamily="var(--font-mono)" fontSize={12}>
        time →
      </text>
    </g>
  );
}

function View({ frame, input }: { frame: Frame<State>; input: Graph }) {
  const s = frame.state;
  const named = hasNames(input);
  const flat = s.stage === 'line' || s.stage === 'arcs';
  const inQ = new Set(s.queue);
  const placed = new Set(s.order);
  const stuck = new Set(s.stuck);

  const nodeTones: Record<string, Tone | undefined> = {};
  const badges: Record<string, number | undefined> = {};
  const badgeTones: Record<string, Tone | undefined> = {};
  const subs: Record<string, string | undefined> = {};
  const rings: Record<string, Tone | undefined> = {};
  for (const n of s.nodes) {
    const id = n.id;
    nodeTones[id] = stuck.has(id) ? 'danger' : id === s.cur && s.stage !== 'count' ? 'active' : placed.has(id) ? 'done' : inQ.has(id) ? 'frontier' : undefined;
    if (s.showDeg && !flat && !placed.has(id)) {
      badges[id] = s.indeg[id];
      badgeTones[id] = s.indeg[id] === 0 ? 'done' : stuck.has(id) ? 'danger' : 'compare';
    }
    if (flat) subs[id] = `${s.order.indexOf(id) + 1}${named ? ` · ${NAMES[id]}` : ''}`;
    else if (named) subs[id] = NAMES[id];
  }
  if (s.cur && s.stage === 'count') rings[s.cur] = 'active';
  if (s.cur && s.stage === 'run') rings[s.cur] = 'active';
  if (s.fresh) rings[s.fresh] = 'frontier';

  const edgeTones: Record<string, Tone | undefined> = {};
  for (const k of s.removed) edgeTones[k] = 'muted';
  for (const e of input.edges) if (stuck.has(e.from) && stuck.has(e.to)) edgeTones[ek(e.from, e.to)] = 'danger';
  if (s.edge) edgeTones[ek(s.edge[0], s.edge[1])] = 'active';

  const n = s.nodes.length;
  const ok = s.stage === 'done' || s.stage === 'line' || s.stage === 'arcs';
  return (
    <VizStack gap={16}>
      <StatRow
        stats={[
          { label: 'placed', value: `${s.order.length}/${n}`, tone: s.order.length === n && n ? 'done' : undefined },
          { label: 'in queue', value: s.queue.length, tone: 'frontier' },
          { label: 'arrows removed', value: `${s.removed.length}/${input.edges.length}` },
        ]}
      />
      <GraphView
        nodes={s.nodes}
        edges={flat ? [] : input.edges}
        directed
        nodeTones={nodeTones}
        edgeTones={edgeTones}
        nodeBadges={badges}
        badgeTones={badgeTones}
        nodeSubs={subs}
        rings={rings}
        travelers={s.edge ? [{ from: s.edge[0], to: s.edge[1], tone: s.stage === 'count' ? 'compare' : 'active' }] : []}
        overlay={s.stage === 'arcs' ? <Arcs nodes={s.nodes} edges={input.edges} order={s.order} /> : undefined}
      />
      <TokenStrip label="queue" empty={s.stage === 'count' ? 'not built yet' : 'empty'} items={s.queue.map((id, i) => ({ id, text: id, tone: i === 0 ? 'active' : 'frontier' }))} />
      <TokenStrip label="order" empty="nothing placed yet" items={s.order.map((id, i) => ({ id, text: `${i + 1}·${id}`, tone: stuck.size ? 'muted' : 'done' }))} />
      <Callout show={ok || s.stage === 'cycle'} tone={s.stage === 'cycle' ? 'danger' : 'found'}>
        {s.stage === 'cycle' ? 'cycle — no topological order' : n ? s.order.join(' → ') : 'empty order'}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  // tiny DAG whose nodes light up in topological order, then a row of output chips fills in
  const nodes = [
    { x: 18, y: 18, t: 0 },
    { x: 18, y: 50, t: 0.12 },
    { x: 58, y: 34, t: 0.3 },
    { x: 98, y: 18, t: 0.48 },
    { x: 98, y: 50, t: 0.62 },
  ];
  const edges = [
    [0, 2],
    [1, 2],
    [2, 3],
    [2, 4],
    [3, 4],
  ];
  return (
    <svg viewBox="0 0 120 80">
      {edges.map(([a, b], k) => (
        <line key={k} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="currentColor" strokeWidth={1.6} strokeOpacity={0.55}>
          <animate attributeName="stroke-opacity" values="0.55;0.55;0.12;0.12;0.55" keyTimes={`0;${nodes[a].t + 0.05};${nodes[a].t + 0.1};0.92;1`} dur="4s" repeatCount="indefinite" />
        </line>
      ))}
      {nodes.map((n, k) => (
        <g key={k}>
          <circle cx={n.x} cy={n.y} r={7} fill="var(--ink-3)" stroke="currentColor" strokeWidth={1.5}>
            <animate attributeName="fill" values="#1b2539;#1b2539;#5fd3a5;#5fd3a5;#1b2539" keyTimes={`0;${n.t};${n.t + 0.04};0.92;1`} dur="4s" repeatCount="indefinite" />
          </circle>
          <rect x={8 + k * 21} y={66} width={17} height={9} rx={3} fill="#5fd3a5" opacity={0}>
            <animate attributeName="opacity" values="0;0;1;1;0" keyTimes={`0;${n.t};${n.t + 0.04};0.92;1`} dur="4s" repeatCount="indefinite" />
          </rect>
        </g>
      ))}
    </svg>
  );
}

const DRESSING: Graph = {
  nodes: [
    { id: 'Und', x: 110, y: 80 },
    { id: 'Sck', x: 90, y: 330 },
    { id: 'Pnt', x: 290, y: 170 },
    { id: 'Sho', x: 300, y: 390 },
    { id: 'Sh', x: 480, y: 70 },
    { id: 'Blt', x: 500, y: 250 },
    { id: 'Tie', x: 690, y: 110 },
    { id: 'Jkt', x: 700, y: 330 },
    { id: 'Wch', x: 520, y: 400 },
  ],
  edges: [
    { from: 'Und', to: 'Pnt', w: 1 },
    { from: 'Und', to: 'Sho', w: 1 },
    { from: 'Pnt', to: 'Blt', w: 1 },
    { from: 'Pnt', to: 'Sho', w: 1 },
    { from: 'Sck', to: 'Sho', w: 1 },
    { from: 'Sh', to: 'Blt', w: 1 },
    { from: 'Sh', to: 'Tie', w: 1 },
    { from: 'Blt', to: 'Jkt', w: 1 },
    { from: 'Tie', to: 'Jkt', w: 1 },
  ],
};

const COURSES: Graph = {
  nodes: [
    { id: 'CS1', x: 90, y: 110 },
    { id: 'CS2', x: 250, y: 110 },
    { id: 'LA', x: 110, y: 340 },
    { id: 'DS', x: 400, y: 80 },
    { id: 'OS', x: 420, y: 250 },
    { id: 'ALG', x: 560, y: 150 },
    { id: 'DB', x: 700, y: 70 },
    { id: 'ML', x: 470, y: 380 },
    { id: 'AI', x: 700, y: 330 },
  ],
  edges: [
    { from: 'CS1', to: 'CS2', w: 1 },
    { from: 'CS2', to: 'DS', w: 1 },
    { from: 'CS2', to: 'OS', w: 1 },
    { from: 'DS', to: 'ALG', w: 1 },
    { from: 'DS', to: 'DB', w: 1 },
    { from: 'ALG', to: 'ML', w: 1 },
    { from: 'LA', to: 'ML', w: 1 },
    { from: 'ML', to: 'AI', w: 1 },
    { from: 'ALG', to: 'AI', w: 1 },
  ],
};

const CYCLE: Graph = {
  nodes: [
    { id: 'A', x: 110, y: 230 },
    { id: 'B', x: 330, y: 110 },
    { id: 'C', x: 560, y: 110 },
    { id: 'D', x: 450, y: 330 },
    { id: 'E', x: 250, y: 380 },
    { id: 'F', x: 690, y: 330 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'B', to: 'C', w: 1 },
    { from: 'C', to: 'D', w: 1 },
    { from: 'D', to: 'B', w: 1 },
    { from: 'A', to: 'E', w: 1 },
    { from: 'C', to: 'F', w: 1 },
  ],
};

const ISOLATED: Graph = {
  nodes: ['A', 'B', 'C', 'D', 'E'].map((id, i) => ({ id, x: 140 + i * 130, y: 200 + (i % 2) * 70 })),
  edges: [],
};

export default defineAlgorithm<Graph, State>({
  id: 'topological-sort',
  name: 'Topological Sort',
  category: 'graphs',
  order: 5,
  tagline: "Order tasks so every prerequisite comes first — Kahn's algorithm.",
  description:
    "Given arrows meaning \"**must happen before**\", find a line-up where every arrow points forward. **Kahn's algorithm** counts each node's **in-degree** (how many arrows point in), then keeps a queue of nodes whose count is **0** — they're free to go. Placing a node removes its outgoing arrows, which may free more nodes. If nodes are left over, they form a **cycle**.",
  howItWorks: [
    "Count every node's **in-degree**: the number of arrows pointing into it.",
    'Put all nodes with in-degree **0** into a queue — nothing blocks them.',
    'Pop a node, append it to the order, and delete its outgoing arrows (decrement their targets).',
    'Any target that reaches **0** joins the queue. Repeat until the queue is empty.',
    'If fewer than **n** nodes were placed, the rest sit on a **cycle** — no valid order exists.',
  ],
  complexity: { time: 'O(V + E)', space: 'O(V)', note: 'Each node is queued once and each arrow is removed once. The order is not unique — using a stack instead of a queue gives another valid order.' },
  code: {
    js: `
function topoSort(nodes, edges) { //@fn
  const indeg = {}, adj = {};
  for (const v of nodes) { indeg[v] = 0; adj[v] = []; } //@init
  for (const [u, v] of edges) { //@count
    adj[u].push(v); indeg[v]++; //@count
  }
  const queue = nodes.filter(v => indeg[v] === 0); //@seed
  const order = [];
  while (queue.length) {
    const u = queue.shift(); //@pop
    order.push(u); //@emit
    for (const v of adj[u]) { //@scan
      indeg[v]--; //@dec
      if (indeg[v] === 0) queue.push(v); //@push
    }
  }
  if (order.length < nodes.length) //@cycle
    throw new Error('cycle: no topological order'); //@cycle
  return order; //@done
}`,
    py: `
from collections import deque

def topo_sort(nodes, edges): #@fn
    indeg = {v: 0 for v in nodes} #@init
    adj = {v: [] for v in nodes} #@init
    for u, v in edges: #@count
        adj[u].append(v); indeg[v] += 1 #@count
    queue = deque(v for v in nodes if indeg[v] == 0) #@seed
    order = []
    while queue:
        u = queue.popleft() #@pop
        order.append(u) #@emit
        for v in adj[u]: #@scan
            indeg[v] -= 1 #@dec
            if indeg[v] == 0: queue.append(v) #@push
    if len(order) < len(nodes): #@cycle
        raise ValueError("cycle: no topological order") #@cycle
    return order #@done`,
  },
  input: {
    default: DRESSING,
    presets: [
      { name: 'Getting dressed', value: DRESSING },
      { name: 'Course prerequisites', value: COURSES },
      { name: 'Has a cycle', value: CYCLE },
      { name: 'No arrows at all', value: ISOLATED },
    ],
    random: () => randomGraph({ directed: true, acyclic: true, weighted: false }),
    Editor: makeGraphEditor({ directed: true, weighted: false, random: { acyclic: true, weighted: false, directed: true } }),
    hint: 'Arrows mean "must come before". Draw a loop of arrows to see cycle detection. Up to 14 nodes.',
  },
  run,
  View,
  legend: [
    { tone: 'frontier', label: 'in queue (in-degree 0)' },
    { tone: 'active', label: 'being placed / arrow removed' },
    { tone: 'done', label: 'placed in order' },
    { tone: 'muted', label: 'arrow used up' },
    { tone: 'danger', label: 'stuck on a cycle' },
  ],
  Glyph,
});
