import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import {
  adjacency,
  Callout,
  ek,
  GRAPH_H,
  GRAPH_W,
  GraphView,
  makeGraphEditor,
  randomGraph,
  StatRow,
  TokenStrip,
  VizSection,
  VizStack,
  type Graph,
  type Traveler,
} from '@/viz';

type Look = { from: string; to: string; kind: 'new' | 'seen' };

interface State {
  dist: Record<string, number>;
  parent: Record<string, string | null>;
  queue: string[];
  cur: string | null;
  processed: string[];
  look: Look | null;
  travel: Traveler | null;
  fresh: string | null; // node discovered on this frame (ripple)
  tree: string[]; // parent edges (ek keys)
  skipped: string[];
  path: string[]; // built backwards from the goal
  target: string | null;
  reached: boolean | null; // null = not decided yet
  done: boolean;
}

/** Literal colours per BFS level — used for the "wave" contours (and SMIL-free CSS). */
const LEVEL = ['#f5b544', '#a98bff', '#6cb6ff', '#5fd3a5', '#c6f36b', '#ffd166', '#ff6b5b', '#e27bff'];
const levelColor = (k: number) => LEVEL[k % LEVEL.length];

function* run(g: Graph): Generator<Frame<State>> {
  const ids = g.nodes.map((n) => n.id);
  const base: State = { dist: {}, parent: {}, queue: [], cur: null, processed: [], look: null, travel: null, fresh: null, tree: [], skipped: [], path: [], target: null, reached: null, done: false };
  if (!ids.length) {
    yield { state: base, line: 'fn', note: 'The graph is empty — add some nodes and edges in the editor first.', phase: 'setup' };
    yield { state: { ...base, done: true }, line: 'done', note: 'Nothing to search.', phase: 'done' };
    return;
  }
  const start = g.source && ids.includes(g.source) ? g.source : ids[0];
  const goal = g.target && ids.includes(g.target) && g.target !== start ? g.target : null;
  const adj = adjacency(g, false);

  const dist: Record<string, number> = {};
  const parent: Record<string, string | null> = {};
  const queue: string[] = [];
  const processed: string[] = [];
  const tree: string[] = [];
  const skipped: string[] = [];
  const path: string[] = [];
  let cur: string | null = null;
  let reached: boolean | null = null;

  const S = (o: Partial<State> = {}): State => ({
    dist: { ...dist },
    parent: { ...parent },
    queue: [...queue],
    cur,
    processed: [...processed],
    look: null,
    travel: null,
    fresh: null,
    tree: [...tree],
    skipped: [...skipped],
    path: [...path],
    target: goal,
    reached,
    done: false,
    ...o,
  });
  const V = (v?: string) => ({ u: cur ?? undefined, v, 'dist[u]': cur ? dist[cur] : undefined, queue: [...queue] });

  yield {
    state: S(),
    line: 'fn',
    note: `Breadth-first search from **${start}** spreads out like a ripple in a pond: first every node **1** edge away, then every node **2** edges away, and so on.${goal ? ` That's why it finds the shortest route to **${goal}**.` : ''}`,
    vars: V(),
    phase: 'setup',
  };

  dist[start] = 0;
  parent[start] = null;
  queue.push(start);
  yield {
    state: S({ fresh: start }),
    line: 'init',
    note: `**${start}** is at distance **0**. Put it in the queue — the queue (first in, first out) is what keeps the wave in order.`,
    vars: V(),
    phase: 'setup',
  };

  let level = 0;
  while (queue.length) {
    const u = queue.shift()!;
    cur = u;
    const newLevel = dist[u] > level;
    if (newLevel) level = dist[u];
    yield {
      state: S(),
      line: 'deq',
      note: newLevel
        ? `The whole distance-${level - 1} ring is done — the wave moves out to **distance ${level}**. Dequeue **${u}** from the front.`
        : `Dequeue **${u}** (distance **${dist[u]}**) from the front of the queue and look at its neighbours.`,
      vars: V(),
      phase: `level ${dist[u]}`,
    };
    for (const { to: v } of adj.get(u) ?? []) {
      if (v in dist) {
        const key = ek(u, v);
        const isTree = tree.includes(key) || tree.includes(ek(v, u));
        if (!isTree && !skipped.includes(key) && !skipped.includes(ek(v, u))) skipped.push(key);
        yield {
          state: S({ look: { from: u, to: v, kind: 'seen' }, travel: { from: u, to: v, tone: 'compare' } }),
          line: 'seen',
          note:
            parent[u] === v
              ? `**${v}** is ${u}'s parent — already discovered, skip.`
              : `**${v}** was already discovered at distance **${dist[v]}** — a shorter or equal route exists, so skip it.`,
          vars: V(v),
          phase: `level ${dist[u]}`,
        };
        continue;
      }
      dist[v] = dist[u] + 1;
      parent[v] = u;
      queue.push(v);
      tree.push(ek(u, v));
      yield {
        state: S({ look: { from: u, to: v, kind: 'new' }, travel: { from: u, to: v, tone: 'frontier' }, fresh: v }),
        line: 'enq',
        note: `**${v}** is new: its distance is ${dist[u]} + 1 = **${dist[v]}**, remember it came from **${u}**, and add it to the **back** of the queue.`,
        vars: V(v),
        phase: `level ${dist[u]}`,
      };
    }
    processed.push(u);
    cur = null;
  }

  const reachedCount = Object.keys(dist).length;
  yield {
    state: S(),
    line: 'loop',
    note: `The queue is empty: all **${reachedCount}** reachable node${reachedCount === 1 ? '' : 's'} have their shortest distance from ${start}${reachedCount < ids.length ? ` (${ids.length - reachedCount} can't be reached)` : ''}.`,
    vars: V(),
    phase: 'path',
  };

  if (goal) {
    if (!(goal in dist)) {
      reached = false;
      yield {
        state: S(),
        line: 'nopath',
        note: `**${goal}** never got a distance — no edges lead there from ${start}, so there is **no path**.`,
        vars: V(goal),
        phase: 'path',
      };
    } else {
      reached = true;
      yield {
        state: S(),
        line: 'path',
        note: `**${goal}** is **${dist[goal]}** edge${dist[goal] === 1 ? '' : 's'} away. Follow the "came from" pointers backwards to recover the route.`,
        vars: V(goal),
        phase: 'path',
      };
      for (let v: string | null = goal; v !== null; v = parent[v]) {
        path.unshift(v);
        const p: string | null = parent[v];
        yield {
          state: S({ travel: p ? { from: v, to: p, tone: 'path' } : null }),
          line: 'back',
          note: p ? `**${v}** came from **${p}** — step back.` : `Reached the start **${v}** — the path is complete: ${path.join(' → ')}.`,
          vars: { ...V(v), path: [...path] },
          phase: 'path',
        };
      }
    }
  }

  yield {
    state: S({ done: true }),
    line: 'done',
    note: goal
      ? reached
        ? `Shortest path **${path.join(' → ')}** with **${path.length - 1}** edge${path.length === 2 ? '' : 's'}. No other route can be shorter, because BFS reached every closer node first.`
        : `BFS is done — every node reachable from ${start} got a distance, but ${goal} isn't one of them.`
      : `BFS is done: the badges show each node's distance (in edges) from **${start}**.`,
    vars: { ...V(), path: [...path] },
    phase: 'done',
  };
}

/* ---------- the wave: topographic contours drawn *under* the graph ---------- */

function Wave({ input, s, index }: { input: Graph; s: State; index: number }) {
  const pos = new Map(input.nodes.map((n) => [n.id, n]));
  const found = Object.keys(s.dist).filter((id) => pos.has(id));
  const maxL = Math.max(-1, ...found.map((id) => s.dist[id]));
  const layers = [];
  for (let k = maxL; k >= 0; k--) {
    const inL = found.filter((id) => s.dist[id] <= k);
    const col = levelColor(k);
    layers.push(
      <g key={`L${k}`} opacity={0.12} style={{ fill: col, stroke: col }}>
        {inL.map((id) => {
          const p = s.parent[id];
          const a = pos.get(id)!;
          const b = p ? pos.get(p) : undefined;
          return (
            <g key={id} className="breadth-first-search-grow" style={{ transformOrigin: `${a.x}px ${a.y}px` }}>
              <circle cx={a.x} cy={a.y} r={46} stroke="none" />
              {b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={56} strokeLinecap="round" />}
            </g>
          );
        })}
      </g>,
    );
  }
  const fresh = s.fresh ? pos.get(s.fresh) : undefined;
  return (
    <svg className="gv" viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} aria-hidden>
      <style>{`
        .breadth-first-search-grow { animation: breadth-first-search-grow calc(var(--step-ms) * 1.3) var(--ease-out); }
        @keyframes breadth-first-search-grow { from { transform: scale(0.35); opacity: 0; } }
        .breadth-first-search-ripple { transform-box: fill-box; transform-origin: center; animation: breadth-first-search-ripple calc(var(--step-ms) * 2.2) var(--ease-out) forwards; }
        @keyframes breadth-first-search-ripple { from { transform: scale(0.3); opacity: 0.95; } to { transform: scale(1); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .breadth-first-search-grow, .breadth-first-search-ripple { animation: none; opacity: 0; } }
      `}</style>
      {layers}
      {fresh && s.fresh && (
        <g key={`rip-${s.fresh}-${index}`}>
          <circle className="breadth-first-search-ripple" cx={fresh.x} cy={fresh.y} r={78} fill="none" stroke={levelColor(s.dist[s.fresh])} strokeWidth={3} />
          <circle className="breadth-first-search-ripple" cx={fresh.x} cy={fresh.y} r={54} fill="none" stroke={levelColor(s.dist[s.fresh])} strokeWidth={2} strokeDasharray="5 6" />
        </g>
      )}
    </svg>
  );
}

function View({ frame, input, index }: { frame: Frame<State>; input: Graph; index: number }) {
  const s = frame.state;
  const inQueue = new Set(s.queue);
  const onPath = new Set(s.path);
  const nodeTones: Record<string, Tone | undefined> = {};
  const badges: Record<string, number | undefined> = {};
  const badgeTones: Record<string, Tone | undefined> = {};
  const subs: Record<string, string | undefined> = {};
  const finished = s.reached !== null || s.done || (s.queue.length === 0 && s.cur === null && s.processed.length > 0);
  for (const n of input.nodes) {
    const id = n.id;
    const known = id in s.dist;
    if (onPath.has(id)) nodeTones[id] = id === s.target ? 'found' : 'path';
    else if (id === s.cur) nodeTones[id] = 'active';
    else if (inQueue.has(id)) nodeTones[id] = 'frontier';
    else if (known) nodeTones[id] = 'visited';
    else if (finished) nodeTones[id] = 'muted';
    if (known) {
      badges[id] = s.dist[id];
      badgeTones[id] = onPath.has(id) ? 'path' : id === s.cur ? 'active' : inQueue.has(id) ? 'frontier' : 'visited';
      const p = s.parent[id];
      if (p) subs[id] = `via ${p}`;
    }
  }
  if (s.target && !(s.target in s.dist) && s.reached === false) subs[s.target] = 'unreachable';
  else if (s.target && !onPath.has(s.target)) subs[s.target] = `${subs[s.target] ? subs[s.target] + ' · ' : ''}goal`;

  const edgeTones: Record<string, Tone | undefined> = {};
  for (const k of s.skipped) edgeTones[k] = 'muted';
  for (const k of s.tree) edgeTones[k] = 'visited';
  for (let i = 0; i + 1 < s.path.length; i++) edgeTones[ek(s.path[i], s.path[i + 1])] = 'path';
  if (s.look) edgeTones[ek(s.look.from, s.look.to)] = s.look.kind === 'new' ? 'active' : 'compare';
  const rings: Record<string, Tone | undefined> = {};
  if (s.cur) rings[s.cur] = 'active';
  if (s.look?.kind === 'seen') rings[s.look.to] = 'compare';

  const levels: string[][] = [];
  for (const id of Object.keys(s.dist)) (levels[s.dist[id]] ??= []).push(id);
  const dots = (k: number) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: levelColor(k), marginRight: 6 }} />;

  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'discovered', value: `${Object.keys(s.dist).length}/${input.nodes.length}`, tone: 'visited' },
          { label: 'in queue', value: s.queue.length, tone: 'frontier' },
          { label: 'wave distance', value: levels.length ? levels.length - 1 : 0, tone: 'active' },
          ...(s.target ? [{ label: `distance to ${s.target}`, value: s.target in s.dist ? s.dist[s.target] : '?', tone: 'found' as Tone }] : []),
        ]}
      />
      <div style={{ position: 'relative' }}>
        <Wave input={input} s={s} index={index} />
        <GraphView
          nodes={input.nodes}
          edges={input.edges}
          nodeTones={nodeTones}
          edgeTones={edgeTones}
          nodeBadges={badges}
          badgeTones={badgeTones}
          nodeSubs={subs}
          rings={rings}
          travelers={s.travel ? [s.travel] : []}
        />
      </div>
      <VizSection label="queue" aside={s.cur ? `processing ${s.cur} · front ← → back` : 'front ← → back'}>
        <TokenStrip items={s.queue.map((id, k) => ({ id, text: `${id}·${s.dist[id]}`, tone: k === 0 ? 'active' : 'frontier' }))} empty="queue empty" />
      </VizSection>
      <VizSection label="rings of the wave">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {levels.length === 0 && <span style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--paper-faint)' }}>not started</span>}
          {levels.map((ids, k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--paper-dim)', minWidth: 58 }}>
                {dots(k)}d = {k}
              </span>
              <TokenStrip items={ids.map((id) => ({ id, text: id, tone: nodeTones[id] ?? 'visited' }))} />
            </div>
          ))}
        </div>
      </VizSection>
      <Callout show={s.done} tone={s.target ? (s.reached ? 'found' : 'danger') : 'visited'}>
        {s.target ? (s.reached ? `${s.path.join(' → ')} · ${s.path.length - 1} edges` : `no path to ${s.target}`) : `${Object.keys(s.dist).length} nodes reached`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const outer = [
    [20, 20],
    [100, 18],
    [16, 62],
    [104, 64],
  ];
  const inner = [
    [60, 14],
    [34, 44],
    [86, 44],
    [60, 70],
  ];
  return (
    <svg viewBox="0 0 120 80">
      {inner.map(([x, y], k) => (
        <line key={`e${k}`} x1={60} y1={42} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} />
      ))}
      {[0, 1, 2].map((k) => (
        <circle key={k} cx={60} cy={42} r={4} fill="none" stroke="currentColor" strokeWidth={1.6}>
          <animate attributeName="r" values="4;52" dur="3s" begin={`${k}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0" dur="3s" begin={`${k}s`} repeatCount="indefinite" />
        </circle>
      ))}
      {inner.map(([x, y], k) => (
        <circle key={`i${k}`} cx={x} cy={y} r={5} fill="#1b2539" stroke="currentColor" strokeWidth={1.4}>
          <animate attributeName="fill" values="#1b2539;#a98bff;#6cb6ff;#1b2539" keyTimes="0;0.25;0.6;1" dur="3s" repeatCount="indefinite" />
        </circle>
      ))}
      {outer.map(([x, y], k) => (
        <circle key={`o${k}`} cx={x} cy={y} r={4.5} fill="#1b2539" stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.7}>
          <animate attributeName="fill" values="#1b2539;#1b2539;#5fd3a5;#1b2539" keyTimes="0;0.45;0.75;1" dur="3s" repeatCount="indefinite" />
        </circle>
      ))}
      <circle cx={60} cy={42} r={6} fill="#f5b544" />
    </svg>
  );
}

const e = (from: string, to: string) => ({ from, to, w: 1 });

const DEFAULT: Graph = {
  nodes: [
    { id: 'A', x: 400, y: 230 },
    { id: 'B', x: 265, y: 150 },
    { id: 'C', x: 540, y: 150 },
    { id: 'D', x: 400, y: 345 },
    { id: 'E', x: 110, y: 90 },
    { id: 'F', x: 130, y: 290 },
    { id: 'G', x: 690, y: 70 },
    { id: 'H', x: 640, y: 320 },
    { id: 'I', x: 250, y: 415 },
    { id: 'J', x: 740, y: 210 },
  ],
  edges: [e('A', 'B'), e('A', 'C'), e('A', 'D'), e('B', 'C'), e('B', 'E'), e('B', 'F'), e('C', 'G'), e('C', 'H'), e('D', 'H'), e('D', 'I'), e('F', 'I'), e('G', 'J'), e('H', 'J')],
  source: 'A',
  target: 'J',
};

const GRIDISH: Graph = {
  nodes: [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => ({ id: 'ABCDEFGHIJKL'[r * 4 + c], x: 150 + c * 170, y: 90 + r * 140 }))),
  edges: [
    e('A', 'B'), e('B', 'C'), e('C', 'D'),
    e('E', 'F'), e('F', 'G'), e('G', 'H'),
    e('I', 'J'), e('J', 'K'), e('K', 'L'),
    e('A', 'E'), e('E', 'I'), e('B', 'F'), e('F', 'J'), e('C', 'G'), e('G', 'K'), e('D', 'H'), e('H', 'L'),
  ],
  source: 'A',
  target: 'L',
};

const ISLAND: Graph = {
  nodes: [
    { id: 'A', x: 140, y: 230 },
    { id: 'B', x: 300, y: 120 },
    { id: 'C', x: 300, y: 340 },
    { id: 'D', x: 440, y: 230 },
    { id: 'E', x: 620, y: 130 },
    { id: 'F', x: 690, y: 330 },
  ],
  edges: [e('A', 'B'), e('A', 'C'), e('B', 'D'), e('C', 'D'), e('E', 'F')],
  source: 'A',
  target: 'F',
};

const LONG_VS_SHORT: Graph = {
  nodes: [
    { id: 'S', x: 100, y: 230 },
    { id: 'A', x: 230, y: 90 },
    { id: 'B', x: 400, y: 60 },
    { id: 'C', x: 570, y: 90 },
    { id: 'D', x: 330, y: 330 },
    { id: 'T', x: 700, y: 230 },
  ],
  edges: [e('S', 'A'), e('A', 'B'), e('B', 'C'), e('C', 'T'), e('S', 'D'), e('D', 'T')],
  source: 'S',
  target: 'T',
};

export default defineAlgorithm<Graph, State>({
  id: 'breadth-first-search',
  name: 'Breadth-First Search',
  category: 'searching',
  order: 4,
  tagline: 'Explore in expanding rings — everything 1 step away, then 2, then 3…',
  description:
    'BFS explores a graph **level by level** using a **queue**: nodes are processed in the order they were discovered, so all nodes at distance *d* are handled before any at distance *d + 1*. In an unweighted graph that makes the first time BFS reaches a node the **shortest path** to it — just follow the "came from" pointers back.',
  howItWorks: [
    'Give the start distance `0` and put it in the queue.',
    'Dequeue the front node `u` and look at each neighbour.',
    'A neighbour seen for the first time gets distance `dist[u] + 1`, remembers `u` as its parent, and joins the **back** of the queue.',
    'Repeat until the queue is empty; walk parent pointers back from the goal to read off the shortest path.',
  ],
  complexity: { time: 'O(V + E)', space: 'O(V)', note: 'Every node is enqueued at most once and every edge is looked at twice (undirected). Shortest paths only for unweighted edges — use Dijkstra for weights.' },
  code: {
    js: `
function bfs(graph, start, goal) { //@fn
  const dist = { [start]: 0 }, parent = { [start]: null }; //@init
  const queue = [start];
  while (queue.length > 0) { //@loop
    const u = queue.shift(); //@deq
    for (const v of graph[u]) {
      if (v in dist) continue; //@seen
      dist[v] = dist[u] + 1; //@enq
      parent[v] = u;
      queue.push(v);
    }
  }
  if (!(goal in dist)) return { dist, path: null }; //@nopath
  const path = []; //@path
  for (let v = goal; v !== null; v = parent[v]) path.unshift(v); //@back
  return { dist, path }; //@done
}`,
    py: `
from collections import deque

def bfs(graph, start, goal): #@fn
    dist, parent = {start: 0}, {start: None} #@init
    queue = deque([start])
    while queue: #@loop
        u = queue.popleft() #@deq
        for v in graph[u]:
            if v in dist: continue #@seen
            dist[v] = dist[u] + 1 #@enq
            parent[v] = u
            queue.append(v)
    if goal not in dist: return dist, None #@nopath
    path, v = [], goal #@path
    while v is not None: #@back
        path.insert(0, v); v = parent[v]
    return dist, path #@done`,
  },
  input: {
    default: DEFAULT,
    presets: [
      { name: 'Ripple from the centre', value: DEFAULT },
      { name: 'Grid (many equal paths)', value: GRIDISH },
      { name: 'Few hops beat a long way', value: LONG_VS_SHORT },
      { name: 'Goal unreachable', value: ISLAND },
    ],
    random: () => randomGraph({ n: randInt(6, 10), weighted: false, density: 0.45 }),
    Editor: makeGraphEditor({ directed: false, weighted: false, pickSource: true, pickTarget: true, random: { weighted: false, density: 0.45 } }),
    hint: 'Pick a Start and a Goal to see the shortest path at the end. Neighbours are queued in alphabetical order.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'dequeued / current' },
    { tone: 'frontier', label: 'in queue' },
    { tone: 'visited', label: 'processed · tree edge' },
    { tone: 'compare', label: 'already seen' },
    { tone: 'path', label: 'shortest path' },
    { tone: 'found', label: 'goal' },
  ],
  Glyph,
});
