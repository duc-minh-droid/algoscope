import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { Callout, ek, GraphView, makeGraphEditor, randomGraph, StatRow, toneFill, toneInk, VizSection, VizStack, type Graph } from '@/viz';
import { checkGraph, Chip, f, INF, nodeMap, RoughDefs } from './_graphsA';

type Mode = 'setup' | 'init' | 'via' | 'cmp' | 'summary' | 'neg' | 'done';

interface State {
  d: number[][];
  mode: Mode;
  k: number;
  i: number;
  j: number;
  better: boolean;
  touched: string[]; // "i,j" cells improved during the current k
  updates: number;
  checks: number;
  negs: number[]; // indices with d[i][i] < 0 (reported at the end)
}

const MAX_N = 7;

function* run(g: Graph): Generator<Frame<State>> {
  checkGraph(g, { maxNodes: MAX_N });
  const ids = g.nodes.map((n) => n.id);
  const n = ids.length;
  const ix = new Map(ids.map((id, i) => [id, i]));
  const d: number[][] = ids.map(() => ids.map(() => INF));
  let mode: Mode = 'setup';
  let k = -1;
  let i = -1;
  let j = -1;
  let better = false;
  let touched: string[] = [];
  let updates = 0;
  let checks = 0;
  let negs: number[] = [];
  const snap = (): State => ({ d: d.map((r) => [...r]), mode, k, i, j, better, touched: [...touched], updates, checks, negs: [...negs] });
  const vars = () => ({
    k: k >= 0 ? ids[k] : undefined,
    i: i >= 0 ? ids[i] : undefined,
    j: j >= 0 ? ids[j] : undefined,
    'd[i][k]': i >= 0 && k >= 0 ? f(d[i][k]) : undefined,
    'd[k][j]': j >= 0 && k >= 0 ? f(d[k][j]) : undefined,
    'd[i][j]': i >= 0 && j >= 0 ? f(d[i][j]) : undefined,
    updates,
  });

  yield {
    state: snap(),
    line: 'fn',
    note: `Floyd–Warshall fills an **${n}×${n}** table: row = from, column = to. It answers *every* pair at once by slowly allowing more and more nodes as stepping stones.`,
    vars: vars(),
    phase: 'setup',
  };
  for (let a = 0; a < n; a++) d[a][a] = 0;
  for (const e of g.edges) d[ix.get(e.from)!][ix.get(e.to)!] = e.w;
  mode = 'init';
  yield {
    state: snap(),
    line: 'init',
    note: `Start with what we know directly: **0** on the diagonal (stay put), the edge weight where an edge exists (${g.edges.length} of them), and **∞** everywhere else.`,
    vars: vars(),
    phase: 'setup',
  };

  for (k = 0; k < n; k++) {
    const K = ids[k];
    touched = [];
    mode = 'via';
    i = j = -1;
    yield {
      state: snap(),
      line: 'k',
      note: `Now allow paths to pass **through ${K}**. For each pair i→j we ask: is **i → ${K} → j** cheaper than the best route so far? Row ${K} and column ${K} hold the two legs.`,
      vars: vars(),
      phase: `via ${K}`,
    };
    let skipped = 0;
    let local = 0;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if (i === k || j === k) continue; // going via yourself never helps
        const a = d[i][k];
        const b = d[k][j];
        if (a === INF || b === INF) {
          skipped++;
          continue;
        }
        const cand = a + b;
        better = cand < d[i][j];
        if (i === j && !better) continue; // d[i][i] = 0 can only drop via a negative cycle
        checks++;
        const old = d[i][j];
        if (better) {
          d[i][j] = cand;
          updates++;
          local++;
          touched = [...touched, `${i},${j}`];
        }
        mode = 'cmp';
        const I = ids[i];
        const J = ids[j];
        yield {
          state: snap(),
          line: better ? ['cmp', 'update'] : 'cmp',
          note: better
            ? `${I}→${K}→${J}: ${a} + ${b} = **${cand} < ${f(old)}**, so update d[${I}][${J}] = **${cand}**.` + (i === j ? ` A loop back to ${I} with negative cost — **negative cycle!**` : '')
            : `${I}→${K}→${J}: ${a} + ${b} = **${cand}** ≥ ${old} — the old route ${I}→${J} is still better (or equal). Keep it.`,
          vars: vars(),
          phase: `via ${K}`,
        };
      }
    }
    i = j = -1;
    better = false;
    mode = 'summary';
    yield {
      state: snap(),
      line: 'ij',
      note:
        `Finished stepping stone **${K}**: **${local}** cell${local === 1 ? '' : 's'} improved.` +
        (skipped ? ` ${skipped} pair${skipped === 1 ? ' was' : 's were'} skipped instantly because a leg to or from ${K} is still ∞.` : ''),
      vars: vars(),
      phase: `via ${K}`,
    };
  }
  k = -1;
  touched = [];
  negs = ids.map((_, a) => a).filter((a) => d[a][a] < 0);
  mode = negs.length ? 'neg' : 'done';
  yield {
    state: snap(),
    line: negs.length ? 'neg' : 'done',
    note: negs.length
      ? `The diagonal went negative at **${negs.map((a) => ids[a]).join(', ')}**: you can leave and return for less than nothing. That's a **negative cycle**, so those distances are meaningless.`
      : `All ${n} stepping stones tried. Every cell now holds the **shortest distance** from its row node to its column node (∞ = unreachable), after **${updates}** updates.`,
    vars: vars(),
    phase: 'done',
  };
}

// ---------- matrix view ----------

function Matrix({ ids, st, index }: { ids: string[]; st: State; index: number }) {
  const { d, k, i, j, better, touched, negs, mode } = st;
  const n = ids.length;
  const C = 54;
  const H = 30;
  const W = H + n * C + 6;
  const toneOf = (r: number, c: number): Tone | undefined => {
    if (negs.includes(r) && r === c) return 'danger';
    if (r === i && c === j) return better ? 'swap' : 'active';
    if ((r === i && c === k) || (r === k && c === j)) return 'compare';
    if (touched.includes(`${r},${c}`)) return 'frontier';
    if (mode === 'done' && d[r][c] < INF && r !== c) return 'done';
    return undefined;
  };
  return (
    <svg viewBox={`0 0 ${W} ${W}`} style={{ width: '100%', maxWidth: W * 1.35, display: 'block', margin: '0 auto', overflow: 'visible' }} role="img" aria-label="distance matrix">
      <style>{`
        .floyd-warshall-cell{transition:fill var(--step-ms) ease, stroke var(--step-ms) ease}
        .floyd-warshall-band{transition:transform var(--step-ms) var(--ease-in-out), opacity var(--step-ms) ease}
        .floyd-warshall-pulse{transform-box:fill-box;transform-origin:center;animation:floyd-warshall-pop calc(var(--step-ms) * 1.5) var(--ease-out) forwards}
        @keyframes floyd-warshall-pop{from{transform:scale(1.5);opacity:.9}to{transform:scale(1);opacity:0}}
        @media (prefers-reduced-motion: reduce){.floyd-warshall-pulse{animation:none;opacity:0}.floyd-warshall-band{transition:opacity 150ms ease}}
      `}</style>
      <RoughDefs id="floyd-warshall-rough" scale={2} />
      {/* via-k bands */}
      <rect
        className="floyd-warshall-band"
        x={H}
        y={0}
        width={n * C}
        height={C}
        rx={10}
        fill="var(--violet)"
        style={{ transform: `translate(0px, ${H + Math.max(0, k) * C}px)`, opacity: k >= 0 ? 0.16 : 0 }}
      />
      <rect
        className="floyd-warshall-band"
        x={0}
        y={H}
        width={C}
        height={n * C}
        rx={10}
        fill="var(--violet)"
        style={{ transform: `translate(${H + Math.max(0, k) * C}px, 0px)`, opacity: k >= 0 ? 0.16 : 0 }}
      />
      {ids.map((id, c) => (
        <text key={`h${c}`} x={H + c * C + C / 2} y={H - 10} textAnchor="middle" fontFamily="var(--font-ui)" fontWeight={700} fontSize={14} fill={c === k ? 'var(--violet)' : c === j ? 'var(--amber)' : 'var(--paper-dim)'}>
          {id}
        </text>
      ))}
      {ids.map((id, r) => (
        <text key={`v${r}`} x={H - 12} y={H + r * C + C / 2 + 5} textAnchor="middle" fontFamily="var(--font-ui)" fontWeight={700} fontSize={14} fill={r === k ? 'var(--violet)' : r === i ? 'var(--amber)' : 'var(--paper-dim)'}>
          {id}
        </text>
      ))}
      <text x={4} y={12} fontSize={9} fontFamily="var(--font-mono)" fill="var(--paper-faint)">
        from↓ to→
      </text>
      {d.map((row, r) =>
        row.map((v, c) => {
          const t = toneOf(r, c);
          const x = H + c * C + 3;
          const y = H + r * C + 3;
          const s = C - 6;
          const label = f(v);
          return (
            <g key={`${r}-${c}`}>
              <rect
                className="floyd-warshall-cell"
                x={x}
                y={y}
                width={s}
                height={s}
                rx={9}
                style={{ fill: t ? toneFill(t) : r === c ? 'var(--ink-2)' : 'var(--ink-3)', stroke: t ? 'transparent' : 'var(--line-strong)' }}
              />
              {r === i && c === j && better && (
                <rect key={`p${index}`} className="floyd-warshall-pulse" x={x} y={y} width={s} height={s} rx={9} fill="none" stroke="var(--magenta)" strokeWidth={3} />
              )}
              <text
                x={x + s / 2}
                y={y + s / 2 + 5}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontWeight={600}
                fontSize={label.length > 3 ? 12 : 15}
                style={{ fill: t ? toneInk(t) : v === INF ? 'var(--paper-faint)' : 'var(--paper)' }}
              >
                {label}
              </text>
            </g>
          );
        }),
      )}
      {i >= 0 && k >= 0 && (
        // hand-drawn hint: leg cells → target cell
        <path
          d={`M${H + k * C + C / 2} ${H + i * C + C / 2} L${H + j * C + C / 2} ${H + i * C + C / 2} M${H + j * C + C / 2} ${H + k * C + C / 2} L${H + j * C + C / 2} ${H + i * C + C / 2}`}
          fill="none"
          stroke={better ? 'var(--magenta)' : 'var(--coral)'}
          strokeWidth={2}
          strokeDasharray="4 5"
          strokeLinecap="round"
          opacity={0.55}
          filter="url(#floyd-warshall-rough)"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}

function View({ frame, input, index }: { frame: Frame<State>; input: Graph; index: number }) {
  const st = frame.state;
  const { d, mode, k, i, j, better, updates, checks, negs } = st;
  const ids = input.nodes.map((n) => n.id);
  const pos = nodeMap(input);
  const K = k >= 0 ? ids[k] : undefined;
  const I = i >= 0 ? ids[i] : undefined;
  const J = j >= 0 ? ids[j] : undefined;

  const nodeTones: Record<string, Tone | undefined> = {};
  const rings: Record<string, Tone | undefined> = {};
  const edgeTones: Record<string, Tone | undefined> = {};
  if (K) {
    nodeTones[K] = 'frontier';
    rings[K] = 'frontier';
    for (const e of input.edges) if (e.from === K || e.to === K) edgeTones[ek(e.from, e.to)] = 'visited';
  }
  if (I) nodeTones[I] = 'compare';
  if (J) nodeTones[J] = better ? 'swap' : 'active';
  for (const a of negs) nodeTones[ids[a]] = 'danger';

  let overlay = null;
  if (I && J && K) {
    const pi = pos.get(I)!;
    const pk = pos.get(K)!;
    const pj = pos.get(J)!;
    const bend = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      return `Q${mx - (dy / L) * 40} ${my + (dx / L) * 40} ${b.x} ${b.y}`;
    };
    const col = better ? '#ff5fa2' : '#ff6b5b';
    overlay = (
      <g style={{ pointerEvents: 'none' }}>
        <RoughDefs id="floyd-warshall-graph-rough" scale={3} />
        <path
          key={`${I}${K}${J}`}
          d={`M${pi.x} ${pi.y} ${bend(pi, pk)} ${bend(pk, pj)}`}
          fill="none"
          stroke={col}
          strokeWidth={3}
          strokeDasharray="9 7"
          strokeLinecap="round"
          opacity={0.85}
          filter="url(#floyd-warshall-graph-rough)"
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-32" dur="0.9s" repeatCount="indefinite" />
        </path>
        <g transform={`translate(${pk.x} ${pk.y - 52})`}>
          <rect x={-46} y={-13} width={92} height={24} rx={12} fill="var(--ink-1)" stroke={col} strokeWidth={1.5} />
          <text textAnchor="middle" y={4} fontFamily="var(--font-mono)" fontWeight={700} fontSize={12} fill={col}>
            {`${I}→${K}→${J}`}
          </text>
        </g>
      </g>
    );
  }

  const cand = I && J && K ? d[i][k] + d[k][j] : undefined;
  return (
    <VizStack gap={14}>
      <StatRow
        stats={[
          { label: 'via (k)', value: K ?? '—', tone: 'frontier' },
          { label: 'comparisons shown', value: checks },
          { label: 'updates', value: updates, tone: 'swap' },
        ]}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, width: '100%', alignItems: 'center' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <GraphView nodes={input.nodes} edges={input.edges} directed weighted nodeTones={nodeTones} rings={rings} edgeTones={edgeTones} overlay={overlay} dimIdle={!!K} />
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <VizSection label="dist matrix" aside={K ? `row & column ${K} = the two legs` : 'row = from, column = to'}>
            <Matrix ids={ids} st={st} index={index} />
          </VizSection>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 32 }}>
        {I && J && K && cand !== undefined ? (
          <>
            <Chip tone="compare">{`d[${I}][${K}] ${f(st.d[i][k])}`}</Chip>
            <span style={{ color: 'var(--paper-dim)' }}>+</span>
            <Chip tone="compare">{`d[${K}][${J}] ${f(st.d[k][j])}`}</Chip>
            <span style={{ color: 'var(--paper-dim)' }}>=</span>
            <Chip tone={better ? 'swap' : 'idle'}>{f(cand)}</Chip>
            <span style={{ color: 'var(--paper-dim)', fontFamily: 'var(--font-mono)' }}>{better ? '→ new' : '≥'}</span>
            <Chip tone={better ? 'swap' : 'active'}>{`d[${I}][${J}] ${f(st.d[i][j])}`}</Chip>
          </>
        ) : (
          <span style={{ color: 'var(--paper-faint)', fontStyle: 'italic', fontSize: 13 }}>
            {mode === 'via' ? `Testing every pair i → ${K} → j…` : mode === 'summary' ? 'Next stepping stone coming up.' : 'd[i][j] = min(d[i][j], d[i][k] + d[k][j])'}
          </span>
        )}
      </div>
      <Callout show={mode === 'done' || mode === 'neg'} tone={mode === 'neg' ? 'danger' : 'path'}>
        {mode === 'neg' ? `negative cycle through ${negs.map((a) => ids[a]).join(', ')}` : `all-pairs shortest paths · ${updates} updates`}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const cells = [0, 1, 2, 3];
  const S = 13;
  const ox = 58;
  const oy = 12;
  return (
    <svg viewBox="0 0 120 80">
      {cells.map((r) =>
        cells.map((c) => <rect key={`${r}${c}`} x={ox + c * (S + 2)} y={oy + r * (S + 2)} width={S} height={S} rx={2.5} fill="#1b2539" stroke="currentColor" strokeOpacity={0.35} />),
      )}
      <rect x={ox - 1} y={oy - 1} width={4 * (S + 2)} height={S + 2} rx={3} fill="#a98bff" opacity={0.35}>
        <animate attributeName="y" values={cells.map((r) => oy - 1 + r * (S + 2)).join(';')} dur="4s" calcMode="discrete" repeatCount="indefinite" />
      </rect>
      <rect x={ox - 1} y={oy - 1} width={S + 2} height={4 * (S + 2)} rx={3} fill="#a98bff" opacity={0.35}>
        <animate attributeName="x" values={cells.map((c) => ox - 1 + c * (S + 2)).join(';')} dur="4s" calcMode="discrete" repeatCount="indefinite" />
      </rect>
      <rect x={ox + 2 * (S + 2)} y={oy + 3 * (S + 2)} width={S} height={S} rx={2.5} fill="#ff5fa2">
        <animate attributeName="opacity" values="0;1;0;0;1;0" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* tiny graph: i → k → j */}
      <path d="M12 60 Q 22 22 34 22 Q 44 22 46 58" fill="none" stroke="#ff6b5b" strokeWidth={2} strokeDasharray="4 3">
        <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.8s" repeatCount="indefinite" />
      </path>
      <line x1={12} y1={62} x2={46} y2={62} stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} />
      <circle cx={12} cy={62} r={5} fill="#1b2539" stroke="currentColor" strokeWidth={1.6} />
      <circle cx={46} cy={62} r={5} fill="#1b2539" stroke="currentColor" strokeWidth={1.6} />
      <circle cx={30} cy={20} r={5.5} fill="#a98bff">
        <animate attributeName="r" values="5.5;7;5.5" dur="1.2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

const DEFAULT: Graph = {
  nodes: [
    { id: 'A', x: 130, y: 110 },
    { id: 'B', x: 400, y: 70 },
    { id: 'C', x: 670, y: 140 },
    { id: 'D', x: 560, y: 380 },
    { id: 'E', x: 200, y: 370 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 3 },
    { from: 'B', to: 'C', w: 4 },
    { from: 'B', to: 'D', w: 7 },
    { from: 'A', to: 'E', w: 8 },
    { from: 'E', to: 'D', w: 2 },
    { from: 'D', to: 'C', w: 1 },
    { from: 'C', to: 'A', w: 2 },
    { from: 'D', to: 'B', w: -4 },
  ],
};

const NEG: Graph = {
  nodes: [
    { id: 'A', x: 150, y: 330 },
    { id: 'B', x: 400, y: 90 },
    { id: 'C', x: 650, y: 330 },
    { id: 'D', x: 400, y: 400 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 1 },
    { from: 'B', to: 'C', w: -3 },
    { from: 'C', to: 'A', w: 1 },
    { from: 'C', to: 'D', w: 2 },
  ],
};

const SPARSE: Graph = {
  nodes: [
    { id: 'A', x: 100, y: 230 },
    { id: 'B', x: 250, y: 100 },
    { id: 'C', x: 400, y: 230 },
    { id: 'D', x: 550, y: 100 },
    { id: 'E', x: 700, y: 230 },
    { id: 'F', x: 400, y: 400 },
  ],
  edges: [
    { from: 'A', to: 'B', w: 2 },
    { from: 'B', to: 'C', w: 2 },
    { from: 'C', to: 'D', w: 2 },
    { from: 'D', to: 'E', w: 2 },
    { from: 'A', to: 'C', w: 5 },
    { from: 'F', to: 'C', w: 1 },
  ],
};

export default defineAlgorithm<Graph, State>({
  id: 'floyd-warshall',
  name: 'Floyd–Warshall',
  category: 'graphs',
  order: 4,
  tagline: 'Shortest paths between every pair, by letting each node in turn be a stepping stone.',
  description:
    'Floyd–Warshall computes the shortest distance between **all pairs** of nodes in one table. It loops over a "via" node **k** and, for every pair, checks whether going **i → k → j** beats the current best — `d[i][j] = min(d[i][j], d[i][k] + d[k][j])`. Negative edges are fine; a negative value on the **diagonal** reveals a negative cycle.',
  howItWorks: [
    'Fill the matrix: 0 on the diagonal, edge weights where edges exist, ∞ elsewhere.',
    'Pick a stepping stone k (every node, one at a time).',
    'For every pair (i, j), compare d[i][k] + d[k][j] with d[i][j] and keep the smaller.',
    'After all k, each cell is a true shortest distance; a negative diagonal means a negative cycle.',
  ],
  complexity: { time: 'O(V³)', space: 'O(V²)', note: 'Three nested loops — great for small, dense graphs. Only non-trivial comparisons are animated.' },
  code: {
    js: `
function floydWarshall(n, edges) { //@fn
  const d = Array.from({ length: n }, (_, i) => //@init
    Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity))); //@init
  for (const { from, to, w } of edges) d[from][to] = w; //@init
  for (let k = 0; k < n; k++) //@k
    for (let i = 0; i < n; i++) //@ij
      for (let j = 0; j < n; j++) //@ij
        if (d[i][k] + d[k][j] < d[i][j]) //@cmp
          d[i][j] = d[i][k] + d[k][j]; //@update
  for (let i = 0; i < n; i++) //@neg
    if (d[i][i] < 0) throw new Error('negative cycle'); //@neg
  return d; //@done
}`,
    py: `
def floyd_warshall(n, edges): #@fn
    INF = float('inf') #@init
    d = [[0 if i == j else INF for j in range(n)] for i in range(n)] #@init
    for u, v, w in edges: #@init
        d[u][v] = w #@init
    for k in range(n): #@k
        for i in range(n): #@ij
            for j in range(n): #@ij
                if d[i][k] + d[k][j] < d[i][j]: #@cmp
                    d[i][j] = d[i][k] + d[k][j] #@update
    for i in range(n): #@neg
        if d[i][i] < 0: #@neg
            raise ValueError('negative cycle') #@neg
    return d #@done`,
  },
  input: {
    default: DEFAULT,
    presets: [
      { name: 'Five nodes, one negative edge', value: DEFAULT },
      { name: 'Negative cycle', value: NEG },
      { name: 'Sparse (lots of ∞)', value: SPARSE },
    ],
    random: () => randomGraph({ n: randInt(4, 6), directed: true, weighted: true, allowNegative: Math.random() < 0.3, density: 0.6 }),
    Editor: makeGraphEditor({ directed: true, weighted: true, allowNegative: true, maxNodes: MAX_N, random: { n: 5 } }),
    hint: `Directed, up to ${MAX_N} nodes. Negative edges allowed; negative cycles are detected.`,
  },
  run,
  View,
  legend: [
    { tone: 'frontier', label: 'via node k / improved this round' },
    { tone: 'compare', label: 'the two legs' },
    { tone: 'active', label: 'cell being checked' },
    { tone: 'swap', label: 'cell improved' },
    { tone: 'done', label: 'final distance' },
    { tone: 'danger', label: 'negative cycle' },
  ],
  Glyph,
});
