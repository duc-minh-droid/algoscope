import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { Callout, ek, GraphView, makeGraphEditor, randomGraph, StatRow, VizSection, VizStack, type Graph, type Traveler } from '@/viz';
import { checkGraph, Chip, DistRow, f, INF, Split } from './_graphsA';

type EdgeSt = 'check' | 'better' | 'worse' | 'unreached' | 'neg';

interface State {
  dist: Record<string, number>;
  prev: Record<string, string | null>;
  round: number; // 1..n-1, or n for the detection pass
  mode: 'setup' | 'rounds' | 'check' | 'done';
  ei: number; // edge index being examined (-1 none)
  st: EdgeSt | null;
  seen: number[]; // edge indices examined this round
  improvedNow: number[]; // edge indices that improved something this round
  updated: string | null;
  updates: number;
  checks: number;
  early: boolean;
  cycle: { nodes: string[]; edges: string[]; weight: number } | null;
}

function* run(g: Graph): Generator<Frame<State>> {
  checkGraph(g, { source: true, maxNodes: 10, maxEdges: 30 });
  const s = g.source!;
  const ids = g.nodes.map((n) => n.id);
  const n = ids.length;
  const E = g.edges;
  const dist: Record<string, number> = Object.fromEntries(ids.map((id) => [id, INF]));
  const prev: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]));
  dist[s] = 0;
  let round = 0;
  let mode: State['mode'] = 'setup';
  let ei = -1;
  let st: EdgeSt | null = null;
  let seen: number[] = [];
  let improvedNow: number[] = [];
  let updated: string | null = null;
  let updates = 0;
  let checks = 0;
  let early = false;
  let cycle: State['cycle'] = null;
  const snap = (): State => ({
    dist: { ...dist },
    prev: { ...prev },
    round,
    mode,
    ei,
    st,
    seen: [...seen],
    improvedNow: [...improvedNow],
    updated,
    updates,
    checks,
    early,
    cycle: cycle && { nodes: [...cycle.nodes], edges: [...cycle.edges], weight: cycle.weight },
  });
  const vars = (e?: { from: string; to: string; w: number }, changed?: boolean) => ({
    round: round || undefined,
    edge: e ? `${e.from}→${e.to}` : undefined,
    w: e?.w,
    'dist[u]+w': e && dist[e.from] < INF ? f(dist[e.from] + e.w) : undefined,
    'dist[v]': e ? f(dist[e.to]) : undefined,
    changed,
  });

  yield {
    state: snap(),
    line: 'init',
    note: `All distances start at **∞**, except the start **${s}** at **0**. Unlike Dijkstra we won't pick nodes cleverly — we just relax **every edge**, over and over, up to **${n - 1}** rounds (n − 1).`,
    vars: vars(),
    phase: 'setup',
  };

  mode = 'rounds';
  for (round = 1; round < n; round++) {
    let changed = false;
    seen = [];
    improvedNow = [];
    ei = -1;
    st = null;
    updated = null;
    yield {
      state: snap(),
      line: 'round',
      note: `**Round ${round}** of ${n - 1}: sweep through all ${E.length} edges. After this round, every shortest path that uses at most **${round}** edge${round > 1 ? 's' : ''} is correct.`,
      vars: vars(undefined, false),
      phase: `round ${round}`,
    };
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      ei = i;
      updated = null;
      seen = [...seen, i];
      checks++;
      if (dist[e.from] === INF) {
        st = 'unreached';
        yield {
          state: snap(),
          line: 'unreached',
          note: `Edge **${e.from}→${e.to}**: dist[${e.from}] is still ∞ — we can't reach ${e.from} yet, so there's nothing to pass on.`,
          vars: vars(e, changed),
          phase: `round ${round}`,
        };
        continue;
      }
      const nd = dist[e.from] + e.w;
      const better = nd < dist[e.to];
      st = better ? 'check' : 'worse';
      yield {
        state: snap(),
        line: 'relax',
        note: better
          ? `Edge **${e.from}→${e.to}** (w = ${e.w}): ${dist[e.from]} + (${e.w}) = **${nd}**, versus dist[${e.to}] = **${f(dist[e.to])}**.`
          : `Edge **${e.from}→${e.to}** (w = ${e.w}): ${dist[e.from]} + (${e.w}) = **${nd}** ≥ ${dist[e.to]} — no improvement.`,
        vars: vars(e, changed),
        phase: `round ${round}`,
      };
      if (better) {
        const old = dist[e.to];
        dist[e.to] = nd;
        prev[e.to] = e.from;
        changed = true;
        updates++;
        improvedNow = [...improvedNow, i];
        st = 'better';
        updated = e.to;
        yield {
          state: snap(),
          line: 'update',
          note: `**${nd} < ${f(old)}**, so update dist[${e.to}] = **${nd}** and remember it came from **${e.from}**.${e.w < 0 ? ' A negative edge just made a route cheaper!' : ''}`,
          vars: vars(e, changed),
          phase: `round ${round}`,
        };
      }
    }
    ei = -1;
    st = null;
    updated = null;
    if (!changed) {
      early = true;
      yield {
        state: snap(),
        line: 'early',
        note: `A whole round with **no changes** — distances have stopped moving, and further rounds would see exactly the same thing. Exit early after round ${round}.`,
        vars: vars(undefined, changed),
        phase: `round ${round}`,
      };
      break;
    }
  }
  if (round >= n) round = n - 1;

  // negative-cycle detection
  mode = 'check';
  seen = [];
  improvedNow = [];
  if (early) {
    yield {
      state: snap(),
      line: 'check',
      note: `Negative-cycle test: since a full pass already changed nothing, another pass can't either — so there is **no negative cycle** reachable from ${s}.`,
      vars: vars(),
      phase: 'cycle check',
    };
  } else {
    round = n;
    yield {
      state: snap(),
      line: 'check',
      note: `${n - 1} rounds are enough for any simple path. One **extra pass**: if some edge can *still* improve a distance, costs can drop forever — a **negative cycle**.`,
      vars: vars(),
      phase: 'cycle check',
    };
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (dist[e.from] === INF) continue;
      ei = i;
      seen = [...seen, i];
      checks++;
      const nd = dist[e.from] + e.w;
      if (nd < dist[e.to]) {
        // walk back n steps to land inside the cycle, then collect it
        const back: Record<string, string | null> = { ...prev, [e.to]: e.from };
        let x: string | null = e.to;
        for (let k = 0; k < n && x; k++) x = back[x];
        const nodes: string[] = [];
        const edges: string[] = [];
        let weight = 0;
        if (x) {
          let y: string = x;
          do {
            const p: string | null = back[y];
            if (!p) break;
            nodes.unshift(y);
            edges.push(ek(p, y));
            weight += E.find((ed) => ed.from === p && ed.to === y)?.w ?? 0;
            y = p;
          } while (y !== x && nodes.length <= n);
        }
        if (!nodes.length) {
          nodes.push(e.from, e.to);
          edges.push(ek(e.from, e.to));
          weight = e.w;
        }
        if (nodes.length) nodes.push(nodes[0]);
        cycle = { nodes, edges, weight };
        st = 'neg';
        yield {
          state: snap(),
          line: 'neg',
          note: `Edge **${e.from}→${e.to}** can still improve: ${dist[e.from]} + (${e.w}) = **${nd}** < ${dist[e.to]}. There's a **negative cycle** (${nodes.join(' → ')}, total **${weight}**) — shortest distances aren't defined.`,
          vars: vars(e),
          phase: 'cycle check',
        };
        mode = 'done';
        ei = -1;
        st = null;
        yield {
          state: snap(),
          line: 'neg',
          note: `Going around the red loop once more always costs **${Math.abs(weight)}** less, so you could loop forever. Bellman–Ford reports the cycle instead of distances.`,
          vars: vars(),
          phase: 'done',
        };
        return;
      }
      st = 'worse';
      yield {
        state: snap(),
        line: 'check',
        note: `Edge **${e.from}→${e.to}**: ${dist[e.from]} + (${e.w}) = ${nd} ≥ ${dist[e.to]} — still settled.`,
        vars: vars(e),
        phase: 'cycle check',
      };
    }
  }
  mode = 'done';
  ei = -1;
  st = null;
  const reached = ids.filter((id) => dist[id] < INF).length;
  yield {
    state: snap(),
    line: 'done',
    note: `Done after **${updates}** updates. ${reached} of ${n} nodes are reachable; the gold edges form the shortest-path tree from **${s}**${reached < n ? ', and ∞ marks nodes no path reaches' : ''}.`,
    vars: vars(),
    phase: 'done',
  };
}

function View({ frame, input }: { frame: Frame<State>; input: Graph }) {
  const { dist, prev, round, mode, ei, st, seen, improvedNow, updated, updates, checks, early, cycle } = frame.state;
  const ids = input.nodes.map((n) => n.id);
  const n = ids.length;
  const e = ei >= 0 ? input.edges[ei] : undefined;

  const edgeTones: Record<string, Tone | undefined> = {};
  for (const v of ids) if (prev[v]) edgeTones[ek(prev[v]!, v)] = mode === 'done' && !cycle ? 'path' : 'frontier';
  if (e) edgeTones[ek(e.from, e.to)] = st === 'better' ? 'swap' : st === 'unreached' ? 'muted' : st === 'neg' ? 'danger' : 'compare';
  if (cycle) for (const k of cycle.edges) edgeTones[k] = 'danger';

  const nodeTones: Record<string, Tone | undefined> = {};
  for (const v of ids) if (dist[v] < INF) nodeTones[v] = mode === 'done' && !cycle ? 'done' : 'frontier';
  if (input.source) nodeTones[input.source] = 'visited';
  if (e) nodeTones[e.from] = st === 'unreached' ? nodeTones[e.from] : 'active';
  if (cycle) for (const v of cycle.nodes) nodeTones[v] = 'danger';

  const rings: Record<string, Tone | undefined> = {};
  if (e) {
    rings[e.from] = 'active';
    rings[e.to] = st === 'better' ? 'swap' : st === 'neg' ? 'danger' : 'compare';
  }
  const badges: Record<string, string> = {};
  const badgeTones: Record<string, Tone | undefined> = {};
  for (const v of ids) {
    badges[v] = f(dist[v]);
    badgeTones[v] = cycle?.nodes.includes(v) ? 'danger' : v === updated ? 'swap' : dist[v] === INF ? 'muted' : dist[v] < 0 ? 'frontier' : 'path';
  }
  const subs: Record<string, string | undefined> = {};
  for (const v of ids) subs[v] = v === input.source ? 'start' : prev[v] ? `via ${prev[v]}` : undefined;
  const travelers: Traveler[] = e && st !== 'unreached' && st !== 'better' ? [{ from: e.from, to: e.to, tone: st === 'neg' ? 'danger' : 'compare' }] : [];

  const roundLabel = mode === 'setup' ? '—' : mode === 'check' || (mode === 'done' && round === n) ? 'extra' : `${round} / ${n - 1}`;

  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'round', value: roundLabel, tone: mode === 'check' ? 'danger' : 'active' },
          { label: 'edge checks', value: checks },
          { label: 'updates', value: updates, tone: 'swap' },
          ...(early ? [{ label: 'early exit', value: '✓', tone: 'done' as Tone }] : []),
        ]}
      />
      <Split
        main={
          <GraphView
            nodes={input.nodes}
            edges={input.edges}
            directed
            weighted
            nodeTones={nodeTones}
            edgeTones={edgeTones}
            nodeBadges={badges}
            badgeTones={badgeTones}
            nodeSubs={subs}
            rings={rings}
            travelers={travelers}
          />
        }
        side={
          <VizSection label={mode === 'check' ? 'extra pass' : mode === 'rounds' ? `round ${round} sweep` : 'edges'}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
              {input.edges.map((ed, i) => {
                const now = i === ei;
                const tone: Tone = now
                  ? st === 'better'
                    ? 'swap'
                    : st === 'neg'
                      ? 'danger'
                      : st === 'unreached'
                        ? 'muted'
                        : 'compare'
                  : improvedNow.includes(i)
                    ? 'frontier'
                    : seen.includes(i)
                      ? 'visited'
                      : 'idle';
                return (
                  <Chip key={ek(ed.from, ed.to)} tone={tone} glow={now}>
                    <span>
                      {ed.from}→{ed.to}
                    </span>
                    <span style={{ opacity: 0.8, color: ed.w < 0 && tone === 'idle' ? 'var(--red)' : undefined }}>{ed.w}</span>
                  </Chip>
                );
              })}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--paper-faint)' }}>Every round checks every edge in this order. Violet = improved something this round.</p>
          </VizSection>
        }
      />
      <VizSection label="dist[ ]" aside="best known cost from the start">
        <DistRow
          ids={ids}
          dist={dist}
          tones={(v) => (cycle?.nodes.includes(v) ? 'danger' : v === updated ? 'swap' : e?.from === v && st !== 'unreached' ? 'active' : e?.to === v ? 'compare' : undefined)}
        />
      </VizSection>
      <Callout show={mode === 'done'} tone={cycle ? 'danger' : 'path'}>
        {cycle ? `negative cycle: ${cycle.nodes.join(' → ')} (${cycle.weight})` : `shortest paths found · ${updates} updates`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const xs = [14, 42, 70, 98];
  return (
    <svg viewBox="0 0 120 80">
      {xs.slice(0, 3).map((x, i) => (
        <line key={i} x1={x + 7} y1={40} x2={xs[i + 1] - 7} y2={40} stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} />
      ))}
      <path d="M98 34 C 80 6, 32 6, 14 34" fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} strokeDasharray="3 3" />
      <circle r={4} fill="#ff6b5b">
        <animateMotion path="M21 40 L91 40" dur="1.2s" repeatCount="indefinite" />
      </circle>
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={40} r={7} fill="#1b2539" stroke="currentColor" strokeWidth={1.8}>
          <animate attributeName="fill" values={i === 0 ? '#5fd3a5;#5fd3a5' : `#1b2539;#1b2539;#ffd166;#ffd166`} keyTimes={i === 0 ? '0;1' : `0;${(i * 0.25).toFixed(2)};${(i * 0.25 + 0.05).toFixed(2)};1`} dur="3.6s" repeatCount="indefinite" />
        </circle>
      ))}
      {[1, 2, 3].map((k) => (
        <text key={k} x={60} y={70} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="currentColor" opacity={0}>
          round {k}
          <animate attributeName="opacity" values="0;1;1;0;0" keyTimes={`0;${((k - 1) / 3 + 0.01).toFixed(2)};${(k / 3 - 0.02).toFixed(2)};${(k / 3).toFixed(2)};1`} dur="3.6s" repeatCount="indefinite" />
        </text>
      ))}
    </svg>
  );
}

const DEFAULT: Graph = {
  nodes: [
    { id: 'A', x: 90, y: 230 },
    { id: 'B', x: 280, y: 90 },
    { id: 'C', x: 280, y: 370 },
    { id: 'D', x: 500, y: 90 },
    { id: 'E', x: 500, y: 370 },
    { id: 'F', x: 710, y: 230 },
  ],
  edges: [
    { from: 'D', to: 'F', w: 4 },
    { from: 'E', to: 'F', w: 2 },
    { from: 'D', to: 'B', w: -2 },
    { from: 'E', to: 'D', w: 7 },
    { from: 'C', to: 'D', w: -3 },
    { from: 'C', to: 'E', w: 9 },
    { from: 'B', to: 'C', w: 8 },
    { from: 'B', to: 'E', w: -4 },
    { from: 'A', to: 'C', w: 7 },
    { from: 'A', to: 'B', w: 6 },
  ],
  source: 'A',
};

const NEG_CYCLE: Graph = {
  nodes: [
    { id: 'A', x: 100, y: 230 },
    { id: 'B', x: 300, y: 110 },
    { id: 'C', x: 520, y: 110 },
    { id: 'D', x: 420, y: 350 },
    { id: 'E', x: 700, y: 330 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'B', to: 'C', w: 2 },
    { from: 'C', to: 'D', w: -4 },
    { from: 'D', to: 'B', w: 1 },
    { from: 'D', to: 'E', w: 2 },
    { from: 'A', to: 'E', w: 8 },
  ],
  source: 'A',
};

const EARLY: Graph = {
  nodes: [
    { id: 'A', x: 90, y: 300 },
    { id: 'B', x: 250, y: 130 },
    { id: 'C', x: 410, y: 300 },
    { id: 'D', x: 570, y: 130 },
    { id: 'E', x: 720, y: 300 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 2 },
    { from: 'B', to: 'C', w: 3 },
    { from: 'A', to: 'C', w: 6 },
    { from: 'C', to: 'D', w: -1 },
    { from: 'D', to: 'E', w: 4 },
    { from: 'C', to: 'E', w: 5 },
  ],
  source: 'A',
};

export default defineAlgorithm<Graph, State>({
  id: 'bellman-ford',
  name: 'Bellman–Ford',
  category: 'graphs',
  order: 3,
  tagline: 'Relax every edge, n − 1 times — negative weights welcome, negative cycles caught.',
  description:
    'Bellman–Ford finds shortest paths from one start node even when some edges have **negative weights**. It simply relaxes **every edge** in rounds: after round k, all shortest paths with at most k edges are right, so **n − 1** rounds suffice. One extra pass exposes **negative cycles**, where costs could fall forever.',
  howItWorks: [
    'Set every distance to ∞ and the start to 0.',
    'Repeat n − 1 times: for each edge u→v, if dist[u] + w < dist[v], update dist[v].',
    'If a whole round changes nothing, stop early — nothing will change later either.',
    'Finally, check every edge once more: any further improvement means a negative cycle.',
  ],
  complexity: { time: 'O(V · E)', space: 'O(V)', note: 'Slower than Dijkstra, but handles negative edges and detects negative cycles.' },
  code: {
    js: `
function bellmanFord(nodes, edges, source) { //@fn
  const dist = {}, prev = {}; //@init
  for (const v of nodes) dist[v] = Infinity; //@init
  dist[source] = 0; //@init
  for (let k = 1; k < nodes.length; k++) { //@round
    let changed = false; //@round
    for (const { from: u, to: v, w } of edges) {
      if (dist[u] === Infinity) continue; //@unreached
      if (dist[u] + w < dist[v]) { //@relax
        dist[v] = dist[u] + w; //@update
        prev[v] = u; changed = true; //@update
      }
    }
    if (!changed) break; // nothing moved: done early //@early
  }
  for (const { from: u, to: v, w } of edges) //@check
    if (dist[u] + w < dist[v]) //@check
      throw new Error('negative cycle'); //@neg
  return { dist, prev }; //@done
}`,
    py: `
def bellman_ford(nodes, edges, source): #@fn
    dist = {v: float('inf') for v in nodes} #@init
    prev = {} #@init
    dist[source] = 0 #@init
    for k in range(1, len(nodes)): #@round
        changed = False #@round
        for u, v, w in edges:
            if dist[u] == float('inf'): #@unreached
                continue #@unreached
            if dist[u] + w < dist[v]: #@relax
                dist[v] = dist[u] + w #@update
                prev[v] = u; changed = True #@update
        if not changed: #@early
            break  # nothing moved: done early #@early
    for u, v, w in edges: #@check
        if dist[u] + w < dist[v]: #@check
            raise ValueError('negative cycle') #@neg
    return dist, prev #@done`,
  },
  input: {
    default: DEFAULT,
    presets: [
      { name: 'Negative edges, no cycle', value: DEFAULT },
      { name: 'Negative cycle', value: NEG_CYCLE },
      { name: 'Lucky order (early exit)', value: EARLY },
    ],
    random: () => randomGraph({ n: randInt(5, 7), directed: true, weighted: true, allowNegative: true, density: 0.5 }),
    Editor: makeGraphEditor({ directed: true, weighted: true, allowNegative: true, pickSource: true, maxNodes: 10 }),
    hint: 'Directed, weights may be negative. Edge order in the list = relaxation order.',
  },
  run,
  View,
  legend: [
    { tone: 'compare', label: 'edge being relaxed' },
    { tone: 'swap', label: 'distance improved' },
    { tone: 'frontier', label: 'reached (tentative)' },
    { tone: 'path', label: 'shortest-path tree' },
    { tone: 'danger', label: 'negative cycle' },
  ],
  Glyph,
});
