import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { adjacency, Callout, ek, GraphView, makeGraphEditor, randomGraph, StatRow, TokenStrip, VizSection, VizStack, type Graph, type Traveler } from '@/viz';
import { checkGraph, DistRow, f, INF, pathTo } from './_graphsA';

interface PQEntry {
  id: number;
  node: string;
  d: number;
}

type EdgeState = 'check' | 'better' | 'worse' | 'skip';

interface State {
  dist: Record<string, number>;
  prev: Record<string, string | null>;
  pq: PQEntry[]; // sorted by (d, node)
  popped: number | null; // pq entry id being popped this frame
  settled: string[];
  cur: string | null;
  edge: { from: string; to: string; st: EdgeState } | null;
  updated: string | null;
  path: string[];
  relax: number;
  done: boolean;
}

function* run(g: Graph): Generator<Frame<State>> {
  checkGraph(g, { source: true, noNegative: true });
  const s = g.source!;
  const t = g.target && g.nodes.some((n) => n.id === g.target) ? g.target : undefined;
  const ids = g.nodes.map((n) => n.id);
  const adj = adjacency(g, false);
  const dist: Record<string, number> = Object.fromEntries(ids.map((id) => [id, INF]));
  const prev: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]));
  dist[s] = 0;
  let uid = 0;
  let pq: PQEntry[] = [{ id: uid++, node: s, d: 0 }];
  const settled: string[] = [];
  let popped: number | null = null;
  let cur: string | null = null;
  let edge: State['edge'] = null;
  let updated: string | null = null;
  let path: string[] = [];
  let relax = 0;
  const sortPq = () => pq.sort((a, b) => a.d - b.d || a.node.localeCompare(b.node) || a.id - b.id);
  const snap = (done = false): State => ({
    dist: { ...dist },
    prev: { ...prev },
    pq: pq.map((e) => ({ ...e })),
    popped,
    settled: [...settled],
    cur,
    edge: edge && { ...edge },
    updated,
    path: [...path],
    relax,
    done,
  });
  const vars = (u?: string, v?: string, w?: number, nd?: number) => ({
    u,
    'dist[u]': u ? f(dist[u]) : undefined,
    v,
    w,
    'dist[u]+w': nd === undefined ? undefined : f(nd),
    'dist[v]': v ? f(dist[v]) : undefined,
    'pq size': pq.length,
  });

  yield {
    state: snap(),
    line: 'init',
    note: `Every node starts at distance **∞** except the start **${s}**, which is **0**. The priority queue holds just (${s}, 0).${t ? ` We want the shortest route to **${t}**.` : ''}`,
    vars: vars(),
    phase: 'setup',
  };

  while (pq.length) {
    const top = pq[0];
    popped = top.id;
    cur = top.node;
    edge = null;
    updated = null;
    yield {
      state: snap(),
      line: 'pop',
      note: `Pop the smallest entry **(${top.node}, ${top.d})** — no unfinished node is closer to ${s} than this.`,
      vars: vars(top.node),
      phase: 'explore',
    };
    pq = pq.slice(1);
    popped = null;
    const u = top.node;
    if (settled.includes(u)) {
      yield {
        state: snap(),
        line: 'stale',
        note: `**${u}** is already final with distance **${dist[u]}**, so this (${u}, ${top.d}) entry is **stale** — an old, longer offer. Skip it.`,
        vars: vars(u),
        phase: 'explore',
      };
      cur = null;
      continue;
    }
    settled.push(u);
    yield {
      state: snap(),
      line: 'settle',
      note:
        `**dist[${u}] = ${dist[u]}** is now final: any other route would pass through a node that's at least as far, and weights are never negative.` +
        (u === t ? ` That's our target **${t}**!` : ''),
      vars: vars(u),
      phase: 'explore',
    };
    for (const { to: v, w } of adj.get(u) ?? []) {
      if (settled.includes(v)) {
        edge = { from: u, to: v, st: 'skip' };
        yield {
          state: snap(),
          line: 'skip',
          note: `Edge ${u}–${v}: **${v}** is already final, nothing to improve. Skip.`,
          vars: vars(u, v, w),
          phase: 'explore',
        };
        continue;
      }
      const nd = dist[u] + w;
      relax++;
      const better = nd < dist[v];
      edge = { from: u, to: v, st: better ? 'check' : 'worse' };
      updated = null;
      yield {
        state: snap(),
        line: 'relax',
        note: better
          ? `Try reaching **${v}** through ${u}: ${dist[u]} + ${w} = **${nd}**, versus the current best **${f(dist[v])}**.`
          : `Try reaching **${v}** through ${u}: ${dist[u]} + ${w} = **${nd}** ≥ ${dist[v]} — no better than what we have, keep **${dist[v]}**.`,
        vars: vars(u, v, w, nd),
        phase: 'explore',
      };
      if (better) {
        const old = dist[v];
        dist[v] = nd;
        prev[v] = u;
        pq.push({ id: uid++, node: v, d: nd });
        sortPq();
        edge = { from: u, to: v, st: 'better' };
        updated = v;
        yield {
          state: snap(),
          line: 'update',
          note: `**${nd} < ${f(old)}**, so update dist[${v}] = **${nd}**, remember ${v} came from **${u}**, and push (${v}, ${nd}) into the queue.`,
          vars: vars(u, v, w, nd),
          phase: 'explore',
        };
      }
    }
    edge = null;
    updated = null;
    cur = null;
  }

  if (t) path = pathTo(prev, s, t);
  const reach = settled.length;
  yield {
    state: snap(true),
    line: 'done',
    note: !t
      ? `Queue empty — all **${reach}** reachable nodes are final. Mint edges form the **shortest-path tree** from ${s}.`
      : path.length
        ? `Queue empty. Following the "came from" links back from ${t} gives the shortest path **${path.join(' → ')}** with length **${dist[t]}**.`
        : `Queue empty, but **${t}** was never reached — there is no path from ${s} to ${t}. Mint edges show the shortest-path tree of what *is* reachable.`,
    vars: vars(),
    phase: 'done',
  };
}

function View({ frame, input }: { frame: Frame<State>; input: Graph }) {
  const { dist, prev, pq, popped, settled, cur, edge, updated, path, relax, done } = frame.state;
  const ids = input.nodes.map((n) => n.id);
  const done_ = new Set(settled);
  const onPath = new Set(path);
  const pathEdges = new Set(path.slice(1).map((v, i) => ek(path[i], v)));

  const edgeTones: Record<string, Tone | undefined> = {};
  for (const v of ids) {
    const p = prev[v];
    if (!p) continue;
    edgeTones[ek(p, v)] = done ? (pathEdges.has(ek(p, v)) ? 'path' : 'done') : done_.has(v) ? 'done' : 'frontier';
  }
  if (edge) {
    // undirected: clear both key orders so the highlight wins over a tree-edge tone
    const was = edgeTones[ek(edge.from, edge.to)] ?? edgeTones[ek(edge.to, edge.from)];
    delete edgeTones[ek(edge.to, edge.from)];
    edgeTones[ek(edge.from, edge.to)] = edge.st === 'better' ? 'swap' : edge.st === 'skip' ? was ?? 'visited' : 'compare';
  }

  const nodeTones: Record<string, Tone | undefined> = {};
  for (const v of ids) {
    if (done && onPath.has(v)) nodeTones[v] = v === input.target ? 'found' : 'path';
    else if (done_.has(v)) nodeTones[v] = 'done';
    else if (dist[v] < INF) nodeTones[v] = 'frontier';
  }
  if (cur && !done) nodeTones[cur] = 'active';

  const rings: Record<string, Tone | undefined> = {};
  if (cur) rings[cur] = 'active';
  if (edge) rings[edge.to] = edge.st === 'better' ? 'swap' : 'compare';
  if (input.target && !done) rings[input.target] = rings[input.target] ?? 'found';

  const badges: Record<string, string> = {};
  const badgeTones: Record<string, Tone | undefined> = {};
  for (const v of ids) {
    badges[v] = f(dist[v]);
    badgeTones[v] = v === updated ? 'swap' : dist[v] === INF ? 'muted' : done_.has(v) ? 'done' : 'path';
  }
  const subs: Record<string, string | undefined> = {};
  for (const v of ids) {
    if (v === input.source) subs[v] = 'start';
    else if (prev[v]) subs[v] = `via ${prev[v]}`;
    if (v === input.target) subs[v] = subs[v] ? `${subs[v]} · goal` : 'goal';
  }
  const travelers: Traveler[] = edge && edge.st !== 'skip' && edge.st !== 'better' ? [{ from: edge.from, to: edge.to, tone: 'compare' }] : [];
  const tDist = input.target ? dist[input.target] : undefined;

  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'settled', value: `${settled.length} / ${ids.length}`, tone: 'done' },
          { label: 'relaxations', value: relax },
          { label: 'queue size', value: pq.length, tone: 'frontier' },
          ...(input.target ? [{ label: `dist to ${input.target}`, value: f(tDist ?? INF), tone: 'path' as Tone }] : []),
        ]}
      />
      <GraphView
        nodes={input.nodes}
        edges={input.edges}
        weighted
        nodeTones={nodeTones}
        edgeTones={edgeTones}
        nodeBadges={badges}
        badgeTones={badgeTones}
        nodeSubs={subs}
        rings={rings}
        travelers={travelers}
      />
      <VizSection label="priority queue" aside="smallest distance leaves first">
        <TokenStrip
          empty="empty — every reachable node is final"
          items={pq.map((e) => {
            const stale = dist[e.node] < e.d; // a better offer for this node already exists
            return {
              id: e.id,
              tone: e.id === popped ? 'active' : stale ? 'muted' : e.node === updated ? 'swap' : 'frontier',
              text: stale ? <s>{`${e.node}·${e.d}`}</s> : `${e.node}·${e.d}`,
            };
          })}
        />
      </VizSection>
      <VizSection label="dist[ ]" aside="best known distance from the start">
        <DistRow ids={ids} dist={dist} tones={(v) => (v === updated ? 'swap' : v === cur ? 'active' : done && onPath.has(v) ? 'path' : done_.has(v) ? 'done' : dist[v] < INF ? 'frontier' : undefined)} />
      </VizSection>
      <Callout show={done} tone={!input.target || path.length ? 'path' : 'danger'}>
        {!input.target ? `${settled.length} nodes reached` : path.length ? `${path.join(' → ')} = ${tDist}` : `${input.target} is unreachable`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const P = [
    [16, 40],
    [48, 16],
    [50, 62],
    [82, 36],
    [106, 62],
  ];
  const E = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
    [2, 4],
  ];
  return (
    <svg viewBox="0 0 120 80">
      {E.map(([a, b], i) => (
        <line key={i} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.6} />
      ))}
      <circle cx={16} cy={40} r={6} fill="none" stroke="#5fd3a5" strokeWidth={1.5}>
        <animate attributeName="r" values="6;96" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0" dur="4s" repeatCount="indefinite" />
      </circle>
      <path d="M16 40 L50 62 L82 36 L106 62" fill="none" stroke="#ffd166" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0" keyTimes="0;0.7;0.85;1" dur="4s" repeatCount="indefinite" />
      </path>
      {P.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={6.5} fill="#1b2539" stroke="currentColor" strokeWidth={1.8}>
          <animate
            attributeName="fill"
            values="#1b2539;#1b2539;#5fd3a5;#5fd3a5"
            keyTimes={`0;${(0.05 + i * 0.13).toFixed(2)};${(0.08 + i * 0.13).toFixed(2)};1`}
            dur="4s"
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  );
}

const DEFAULT: Graph = {
  nodes: [
    { id: 'A', x: 90, y: 230 },
    { id: 'B', x: 250, y: 90 },
    { id: 'C', x: 260, y: 370 },
    { id: 'D', x: 420, y: 220 },
    { id: 'E', x: 560, y: 80 },
    { id: 'F', x: 580, y: 370 },
    { id: 'G', x: 720, y: 220 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 4 },
    { from: 'A', to: 'C', w: 2 },
    { from: 'B', to: 'C', w: 1 },
    { from: 'B', to: 'D', w: 5 },
    { from: 'C', to: 'D', w: 8 },
    { from: 'C', to: 'F', w: 10 },
    { from: 'D', to: 'E', w: 3 },
    { from: 'D', to: 'F', w: 2 },
    { from: 'E', to: 'G', w: 6 },
    { from: 'F', to: 'G', w: 3 },
    { from: 'B', to: 'E', w: 12 },
  ],
  source: 'A',
  target: 'G',
};

const TRAP: Graph = {
  nodes: [
    { id: 'A', x: 100, y: 230 },
    { id: 'B', x: 280, y: 90 },
    { id: 'C', x: 520, y: 90 },
    { id: 'D', x: 700, y: 230 },
    { id: 'E', x: 400, y: 380 },
  ],
  edges: [
    { from: 'A', to: 'D', w: 14 },
    { from: 'A', to: 'B', w: 2 },
    { from: 'B', to: 'C', w: 3 },
    { from: 'C', to: 'D', w: 2 },
    { from: 'A', to: 'E', w: 5 },
    { from: 'E', to: 'D', w: 8 },
  ],
  source: 'A',
  target: 'D',
};

const UNREACH: Graph = {
  nodes: [
    { id: 'A', x: 110, y: 130 },
    { id: 'B', x: 310, y: 90 },
    { id: 'C', x: 250, y: 320 },
    { id: 'D', x: 560, y: 150 },
    { id: 'E', x: 700, y: 340 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 3 },
    { from: 'A', to: 'C', w: 6 },
    { from: 'B', to: 'C', w: 2 },
    { from: 'D', to: 'E', w: 4 },
  ],
  source: 'A',
  target: 'E',
};

export default defineAlgorithm<Graph, State>({
  id: 'dijkstra',
  name: "Dijkstra's Shortest Path",
  category: 'graphs',
  order: 2,
  tagline: 'Always finalise the closest unfinished node, then relax its edges.',
  description:
    'Dijkstra finds the shortest distance from a start node to every other node when edge weights are **non-negative**. A **priority queue** always hands back the closest not-yet-final node; its distance can no longer improve, so we lock it in and try to shorten routes to its neighbours ("**relaxing**" edges).',
  howItWorks: [
    'Set every distance to ∞, the start to 0, and put (start, 0) in a min-priority queue.',
    'Pop the smallest entry; if that node is already final, the entry is stale — skip it.',
    'Otherwise mark it final: no shorter route can exist since weights are ≥ 0.',
    'For each neighbour, if dist[u] + w beats dist[v], update it and push the new offer.',
    'Follow the "came from" links backwards to read off the shortest path.',
  ],
  complexity: { time: 'O((V + E) log V)', space: 'O(V + E)', note: 'With a binary heap. Negative weights break the "final" guarantee — use Bellman–Ford instead.' },
  code: {
    js: `
function dijkstra(graph, source) { //@fn
  const dist = {}, prev = {}, done = new Set(); //@init
  for (const v in graph) dist[v] = Infinity; //@init
  dist[source] = 0; //@init
  const pq = new MinHeap([[0, source]]); //@init
  while (pq.size > 0) {
    const [d, u] = pq.pop(); //@pop
    if (done.has(u)) continue; // stale entry //@stale
    done.add(u); // dist[u] is final //@settle
    for (const [v, w] of graph[u]) {
      if (done.has(v)) continue; //@skip
      if (d + w < dist[v]) { //@relax
        dist[v] = d + w; //@update
        prev[v] = u; //@update
        pq.push([dist[v], v]); //@update
      }
    }
  }
  return { dist, prev }; //@done
}`,
    py: `
import heapq

def dijkstra(graph, source): #@fn
    dist = {v: float('inf') for v in graph} #@init
    prev, done = {}, set() #@init
    dist[source] = 0 #@init
    pq = [(0, source)] #@init
    while pq:
        d, u = heapq.heappop(pq) #@pop
        if u in done: #@stale
            continue  # stale entry #@stale
        done.add(u)  # dist[u] is final #@settle
        for v, w in graph[u]:
            if v in done: #@skip
                continue #@skip
            if d + w < dist[v]: #@relax
                dist[v] = d + w #@update
                prev[v] = u #@update
                heapq.heappush(pq, (dist[v], v)) #@update
    return dist, prev #@done`,
  },
  input: {
    default: DEFAULT,
    presets: [
      { name: 'Seven towns', value: DEFAULT },
      { name: 'Direct road is a trap', value: TRAP },
      { name: 'Goal unreachable', value: UNREACH },
    ],
    random: () => randomGraph({ n: randInt(5, 8), weighted: true, density: 0.6 }),
    Editor: makeGraphEditor({ directed: false, weighted: true, allowNegative: false, pickSource: true, pickTarget: true }),
    hint: 'Undirected, weights ≥ 0. Pick a start and a goal with the editor tools.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current node' },
    { tone: 'frontier', label: 'in queue (tentative)' },
    { tone: 'compare', label: 'relaxing edge' },
    { tone: 'swap', label: 'distance improved' },
    { tone: 'done', label: 'final / tree edge' },
    { tone: 'path', label: 'shortest path' },
  ],
  Glyph,
});
