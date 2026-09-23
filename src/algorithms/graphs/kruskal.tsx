import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { Callout, ek, GraphView, makeGraphEditor, randomGraph, StatRow, VizSection, VizStack, type GEdge, type Graph } from '@/viz';
import { checkGraph, Chip, nodeMap, PALETTE, RoughDefs, Split } from './_graphsA';

type Status = 'idle' | 'current' | 'checking' | 'accepted' | 'rejecting' | 'rejected' | 'skipped';

interface State {
  edges: GEdge[]; // in display order (sorted after the "sort" frame)
  status: Status[];
  cur: number;
  root: Record<string, string>; // find(v) for every node (empty before init)
  cycle: string[]; // edge keys of the tree path closing a cycle (rejection frames)
  total: number;
  used: number;
  comps: number;
  sorted: boolean;
  done: boolean;
}

const key = (e: GEdge) => ek(e.from, e.to);

function* run(g: Graph): Generator<Frame<State>> {
  checkGraph(g);
  const n = g.nodes.length;
  const ids = g.nodes.map((v) => v.id);
  let edges = g.edges.map((e) => ({ ...e }));
  let status: Status[] = edges.map(() => 'idle');
  const root: Record<string, string> = {};
  let cycle: string[] = [];
  let total = 0;
  let used = 0;
  let comps = n;
  let sorted = false;
  let cur = -1;
  const snap = (done = false): State => ({ edges: edges.map((e) => ({ ...e })), status: [...status], cur, root: { ...root }, cycle: [...cycle], total, used, comps, sorted, done });
  const vars = (e?: GEdge, ru?: string, rv?: string) => ({
    edge: e ? `${e.from}–${e.to}` : undefined,
    w: e?.w,
    'find(u)': ru,
    'find(v)': rv,
    total,
    'mst size': `${used}/${n - 1}`,
  });

  yield {
    state: snap(),
    line: 'fn',
    note: `Kruskal grows a minimum spanning tree by **greedily** taking the cheapest edge that doesn't close a loop. We have **${n}** nodes and **${edges.length}** edges.`,
    vars: vars(),
    phase: 'setup',
  };

  const order = edges.map((_, i) => i).sort((a, b) => edges[a].w - edges[b].w || a - b);
  edges = order.map((i) => edges[i]);
  status = edges.map(() => 'idle');
  sorted = true;
  yield {
    state: snap(),
    line: 'sort',
    note: edges.length
      ? `Sort the edges from lightest (**${edges[0].w}**) to heaviest (**${edges[edges.length - 1].w}**). Looking at cheap edges first is what makes the greedy choice safe.`
      : 'There are no edges to sort — every node will be its own little tree.',
    vars: vars(),
    phase: 'setup',
  };

  const parent: Record<string, string> = {};
  const size: Record<string, number> = {};
  for (const id of ids) {
    parent[id] = id;
    size[id] = 1;
  }
  const find = (x: string): string => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const refresh = () => ids.forEach((id) => (root[id] = find(id)));
  refresh();
  yield {
    state: snap(),
    line: 'init',
    note: `Start a **disjoint-set** (union–find): every node is alone in its own set. Two nodes are "connected" exactly when they share a set.`,
    vars: vars(),
    phase: 'setup',
  };

  const accepted: GEdge[] = [];
  const treePath = (a: string, b: string): string[] => {
    // BFS over accepted edges; returns edge keys from a to b
    const prev = new Map<string, { node: string; key: string }>();
    const q = [a];
    const seen = new Set([a]);
    while (q.length) {
      const x = q.shift()!;
      if (x === b) break;
      for (const e of accepted) {
        const y = e.from === x ? e.to : e.to === x ? e.from : null;
        if (y && !seen.has(y)) {
          seen.add(y);
          prev.set(y, { node: x, key: key(e) });
          q.push(y);
        }
      }
    }
    const out: string[] = [];
    for (let x = b; prev.has(x); x = prev.get(x)!.node) out.push(prev.get(x)!.key);
    return out;
  };

  let full = n === 1;
  for (let i = 0; i < edges.length && !full; i++) {
    const e = edges[i];
    cur = i;
    status[i] = 'current';
    yield {
      state: snap(),
      line: 'loop',
      note: `Next cheapest edge: **${e.from}–${e.to}** with weight **${e.w}**.`,
      vars: vars(e),
      phase: 'scan edges',
    };
    const ru = find(e.from);
    const rv = find(e.to);
    status[i] = 'checking';
    yield {
      state: snap(),
      line: 'find',
      note:
        ru === rv
          ? `find(${e.from}) = **${ru}** and find(${e.to}) = **${rv}** — the same set! ${e.from} and ${e.to} are already connected.`
          : `find(${e.from}) = **${ru}**, find(${e.to}) = **${rv}** — different sets, so this edge links two separate trees.`,
      vars: vars(e, ru, rv),
      phase: 'scan edges',
    };
    if (ru === rv) {
      status[i] = 'rejecting';
      cycle = treePath(e.from, e.to);
      yield {
        state: snap(),
        line: 'reject',
        note: `Reject **${e.from}–${e.to}**: it **would create a cycle** with the red tree path already joining them — a tree never needs two routes between the same nodes.`,
        vars: vars(e, ru, rv),
        phase: 'scan edges',
      };
      cycle = [];
      status[i] = 'rejected';
      continue;
    }
    let [a, b] = [ru, rv];
    if (size[a] < size[b]) [a, b] = [b, a];
    parent[b] = a;
    size[a] += size[b];
    refresh();
    accepted.push(e);
    total += e.w;
    used++;
    comps--;
    status[i] = 'accepted';
    yield {
      state: snap(),
      line: ['union', 'accept'],
      note: `Accept **${e.from}–${e.to}** (+${e.w}): merge set **${b}** into the bigger set **${a}**. Running total = **${total}**.`,
      vars: vars(e, ru, rv),
      phase: 'scan edges',
    };
    if (used === n - 1) {
      full = true;
      for (let j = i + 1; j < edges.length; j++) status[j] = 'skipped';
      yield {
        state: snap(),
        line: 'full',
        note: `That's **${n - 1}** edges for ${n} nodes — everything is connected, so the remaining ${edges.length - i - 1} edge${edges.length - i - 1 === 1 ? '' : 's'} can't help. Stop early.`,
        vars: vars(e, ru, rv),
        phase: 'scan edges',
      };
    }
  }
  cur = -1;
  yield {
    state: snap(true),
    line: 'done',
    note:
      comps === 1
        ? `Done: the minimum spanning tree uses **${used}** edges with total weight **${total}**. No other set of edges connects every node more cheaply.`
        : `Ran out of edges with **${comps}** separate pieces left — the graph is disconnected, so the answer is a **minimum spanning forest** (${used} edges, weight **${total}**).`,
    vars: vars(),
    phase: 'done',
  };
}

const CHIP_TONE: Record<Status, Tone> = {
  idle: 'idle',
  current: 'active',
  checking: 'compare',
  accepted: 'path',
  rejecting: 'danger',
  rejected: 'muted',
  skipped: 'muted',
};

function View({ frame, input }: { frame: Frame<State>; input: Graph }) {
  const { edges, status, cur, root, cycle, total, used, comps, sorted, done } = frame.state;
  const pos = nodeMap(input);
  const edgeTones: Record<string, Tone | undefined> = {};
  edges.forEach((e, i) => {
    const s = status[i];
    if (s === 'accepted') edgeTones[key(e)] = 'path';
    else if (s === 'current') edgeTones[key(e)] = 'active';
    else if (s === 'checking') edgeTones[key(e)] = 'compare';
    else if (s === 'rejecting') edgeTones[key(e)] = 'danger';
    else if (s === 'rejected' || s === 'skipped') edgeTones[key(e)] = 'muted';
  });
  for (const k of cycle) edgeTones[k] = 'danger';
  const e = cur >= 0 ? edges[cur] : undefined;
  const nodeTones: Record<string, Tone | undefined> = {};
  const rings: Record<string, Tone | undefined> = {};
  if (e) {
    const t = status[cur] === 'rejecting' ? 'danger' : status[cur] === 'accepted' ? 'path' : 'active';
    nodeTones[e.from] = nodeTones[e.to] = t;
    rings[e.from] = rings[e.to] = t;
  }
  const sizes: Record<string, number> = {};
  Object.values(root).forEach((r) => (sizes[r] = (sizes[r] ?? 0) + 1));
  const colorOf = (r: string) => PALETTE[Math.max(0, input.nodes.findIndex((v) => v.id === r)) % PALETTE.length];
  const nodeSubs: Record<string, string | undefined> = {};
  for (const id of Object.keys(root)) nodeSubs[id] = `set ${root[id]}`;

  const overlay = (
    <g>
      <RoughDefs id="kruskal-rough" />
      <style>{`.kruskal-halo{transition:stroke var(--step-ms) ease, opacity var(--step-ms) ease}`}</style>
      {input.nodes.map((v) => {
        const r = root[v.id];
        const on = r !== undefined && sizes[r] > 1;
        return (
          <circle
            key={v.id}
            className="kruskal-halo"
            cx={pos.get(v.id)!.x}
            cy={pos.get(v.id)!.y}
            r={31}
            fill="none"
            strokeWidth={4}
            strokeLinecap="round"
            filter="url(#kruskal-rough)"
            style={{ stroke: on ? colorOf(r) : 'transparent', opacity: on ? 0.9 : 0 }}
          />
        );
      })}
    </g>
  );

  return (
    <VizStack gap={16}>
      <StatRow
        stats={[
          { label: 'total weight', value: total, tone: 'path' },
          { label: 'edges in tree', value: `${used} / ${Math.max(0, input.nodes.length - 1)}` },
          { label: 'components', value: Object.keys(root).length ? comps : input.nodes.length },
        ]}
      />
      <Split
        main={<GraphView nodes={input.nodes} edges={input.edges} weighted edgeTones={edgeTones} nodeTones={nodeTones} rings={rings} nodeSubs={nodeSubs} overlay={overlay} />}
        side={
          <VizSection label={sorted ? 'edges · lightest first' : 'edges · as given'}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
              {edges.map((ed, i) => {
                const s = status[i];
                return (
                  <Chip key={key(ed)} tone={CHIP_TONE[s]} strike={s === 'rejected' || s === 'rejecting'} glow={i === cur}>
                    <span>
                      {ed.from}–{ed.to}
                    </span>
                    <span style={{ opacity: 0.75 }}>{ed.w}</span>
                    {s === 'accepted' && <span aria-label="accepted">✓</span>}
                    {(s === 'rejected' || s === 'rejecting') && <span aria-label="rejected">✕</span>}
                  </Chip>
                );
              })}
              {edges.length === 0 && <span style={{ color: 'var(--paper-faint)', fontStyle: 'italic', fontSize: 12.5 }}>no edges</span>}
            </div>
          </VizSection>
        }
      />
      <Callout show={done} tone={comps === 1 ? 'path' : 'visited'}>
        {comps === 1 ? `MST weight = ${total}` : `spanning forest · ${comps} trees · weight ${total}`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const P = [
    [20, 20],
    [60, 14],
    [100, 26],
    [30, 62],
    [78, 64],
  ];
  const E: [number, number, boolean][] = [
    [0, 1, true],
    [1, 4, true],
    [3, 4, true],
    [0, 3, false],
    [2, 4, true],
  ];
  const dur = '5s';
  return (
    <svg viewBox="0 0 120 80">
      {E.map(([a, b], i) => (
        <line key={`b${i}`} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} />
      ))}
      {E.map(([a, b, ok], i) => {
        const t0 = (i * 0.16 + 0.04).toFixed(2);
        const t1 = (i * 0.16 + 0.14).toFixed(2);
        return (
          <line key={`e${i}`} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} stroke={ok ? '#ffd166' : '#ff4d5e'} strokeWidth={ok ? 3.5 : 2.5} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1">
            <animate attributeName="stroke-dashoffset" values="1;1;0;0;1" keyTimes={`0;${t0};${t1};0.94;1`} dur={dur} repeatCount="indefinite" />
            {!ok && <animate attributeName="opacity" values="1;1;1;0.2;0.2" keyTimes={`0;${t0};${t1};${(i * 0.16 + 0.24).toFixed(2)};1`} dur={dur} repeatCount="indefinite" />}
          </line>
        );
      })}
      <g stroke="#ff4d5e" strokeWidth={2.2} strokeLinecap="round" opacity={0}>
        <path d="M21 37 l8 8 M29 37 l-8 8" />
        <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.56;0.6;0.8;1" dur={dur} repeatCount="indefinite" />
      </g>
      {P.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={6} fill="var(--ink-3)" stroke="currentColor" strokeWidth={1.8} />
      ))}
    </svg>
  );
}

const DEFAULT: Graph = {
  nodes: [
    { id: 'A', x: 100, y: 90 },
    { id: 'B', x: 300, y: 60 },
    { id: 'C', x: 520, y: 80 },
    { id: 'D', x: 710, y: 150 },
    { id: 'E', x: 150, y: 320 },
    { id: 'F', x: 370, y: 240 },
    { id: 'G', x: 600, y: 320 },
    { id: 'H', x: 410, y: 410 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 4 },
    { from: 'A', to: 'E', w: 7 },
    { from: 'B', to: 'E', w: 11 },
    { from: 'B', to: 'C', w: 8 },
    { from: 'B', to: 'F', w: 6 },
    { from: 'C', to: 'F', w: 2 },
    { from: 'C', to: 'D', w: 7 },
    { from: 'C', to: 'G', w: 4 },
    { from: 'D', to: 'G', w: 9 },
    { from: 'E', to: 'F', w: 1 },
    { from: 'F', to: 'G', w: 5 },
    { from: 'F', to: 'H', w: 7 },
    { from: 'G', to: 'H', w: 2 },
    { from: 'E', to: 'H', w: 8 },
  ],
};

const ISLANDS: Graph = {
  nodes: [
    { id: 'A', x: 110, y: 110 },
    { id: 'B', x: 280, y: 80 },
    { id: 'C', x: 200, y: 260 },
    { id: 'D', x: 500, y: 110 },
    { id: 'E', x: 700, y: 90 },
    { id: 'F', x: 540, y: 330 },
    { id: 'G', x: 720, y: 300 },
    { id: 'H', x: 300, y: 410 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 3 },
    { from: 'B', to: 'C', w: 5 },
    { from: 'A', to: 'C', w: 4 },
    { from: 'D', to: 'E', w: 2 },
    { from: 'D', to: 'F', w: 6 },
    { from: 'E', to: 'G', w: 3 },
    { from: 'F', to: 'G', w: 1 },
    { from: 'D', to: 'G', w: 4 },
  ],
};

const TIES: Graph = {
  nodes: [
    { id: 'A', x: 170, y: 110 },
    { id: 'B', x: 400, y: 110 },
    { id: 'C', x: 630, y: 110 },
    { id: 'D', x: 170, y: 350 },
    { id: 'E', x: 400, y: 350 },
    { id: 'F', x: 630, y: 350 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'B', to: 'C', w: 1 },
    { from: 'A', to: 'D', w: 1 },
    { from: 'B', to: 'E', w: 1 },
    { from: 'C', to: 'F', w: 1 },
    { from: 'D', to: 'E', w: 1 },
    { from: 'E', to: 'F', w: 1 },
  ],
};

export default defineAlgorithm<Graph, State>({
  id: 'kruskal',
  name: "Kruskal's MST",
  category: 'graphs',
  order: 1,
  tagline: 'Take the cheapest edges first, skipping any that would close a loop.',
  description:
    "A **minimum spanning tree** connects every node using the least total edge weight. Kruskal sorts all edges by weight and adds them one by one, using a **union–find** structure to instantly tell whether an edge's two ends are already connected — if so, the edge **would create a cycle** and is skipped.",
  howItWorks: [
    'Sort every edge from lightest to heaviest.',
    'Put each node in its own set (a forest of single-node trees).',
    'For each edge: if its ends are in different sets, keep it and merge the sets.',
    'If both ends are already in the same set, the edge would form a cycle — reject it.',
    'Stop after n − 1 edges (or when edges run out: a spanning forest).',
  ],
  complexity: { time: 'O(E log E)', space: 'O(V + E)', note: 'Sorting dominates; union–find with path compression + union by size is nearly O(1) per operation.' },
  code: {
    js: `
function kruskal(nodes, edges) { //@fn
  edges.sort((a, b) => a.w - b.w); //@sort
  const parent = {}, size = {}; //@init
  for (const v of nodes) { parent[v] = v; size[v] = 1; } //@init
  const find = (x) =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const mst = [];
  let total = 0;
  for (const { from: u, to: v, w } of edges) { //@loop
    let ru = find(u), rv = find(v); //@find
    if (ru === rv) continue; // would create a cycle //@reject
    if (size[ru] < size[rv]) [ru, rv] = [rv, ru]; //@union
    parent[rv] = ru; size[ru] += size[rv]; //@union
    mst.push([u, v, w]); total += w; //@accept
    if (mst.length === nodes.length - 1) break; //@full
  }
  return { mst, total }; //@done
}`,
    py: `
def kruskal(nodes, edges): #@fn
    edges.sort(key=lambda e: e[2]) #@sort
    parent = {v: v for v in nodes} #@init
    size = {v: 1 for v in nodes} #@init
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    mst, total = [], 0
    for u, v, w in edges: #@loop
        ru, rv = find(u), find(v) #@find
        if ru == rv: #@reject
            continue  # would create a cycle #@reject
        if size[ru] < size[rv]: ru, rv = rv, ru #@union
        parent[rv] = ru; size[ru] += size[rv] #@union
        mst.append((u, v, w)); total += w #@accept
        if len(mst) == len(nodes) - 1: #@full
            break #@full
    return mst, total #@done`,
  },
  input: {
    default: DEFAULT,
    presets: [
      { name: 'City network', value: DEFAULT },
      { name: 'Two islands (forest)', value: ISLANDS },
      { name: 'All weights equal', value: TIES },
      { name: 'Single node', value: { nodes: [{ id: 'A', x: 400, y: 230 }], edges: [] } },
    ],
    random: () => randomGraph({ n: randInt(5, 8), weighted: true, density: 0.7 }),
    Editor: makeGraphEditor({ directed: false, weighted: true, random: { density: 0.7 } }),
    hint: 'Undirected, weighted. Disconnected graphs give a spanning forest.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'edge considered' },
    { tone: 'compare', label: 'checking sets' },
    { tone: 'path', label: 'in the tree' },
    { tone: 'danger', label: 'would make a cycle' },
    { tone: 'muted', label: 'rejected / not needed' },
  ],
  Glyph,
});
