import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { ArrayView, Callout, TokenStrip, TreeView, VizSection, VizStack, toneFill, type TreeNode } from '@/viz';

type OpName = 'union' | 'find' | 'connected';
interface Op {
  op: OpName;
  a: number;
  b?: number;
}
interface Input {
  n: number;
  ops: Op[];
}

interface LogItem {
  id: number;
  text: string;
  tone: Tone;
}

interface State {
  n: number;
  parent: number[];
  rank: number[];
  cur: number; // node the "finger" is on (-1 = none)
  path: number[]; // nodes visited by the current find, bottom-up
  root: number; // root found by the current find (-1 = not yet)
  written: number; // index whose parent[] / rank[] was just written
  rankHot: number; // index whose rank just changed
  compare: number[]; // two roots whose ranks are compared
  arrows: { from: number; to: number }[]; // planned path-compression shortcuts
  log: LogItem[];
  opIndex: number;
  callout: { text: string; tone: Tone } | null;
}

const opText = (o: Op) => (o.op === 'find' ? `find(${o.a})` : `${o.op}(${o.a}, ${o.b})`);

function* run({ n, ops }: Input): Generator<Frame<State>> {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array<number>(n).fill(0);
  const log: LogItem[] = [];
  let opIndex = -1;
  const blank = { cur: -1, path: [] as number[], root: -1, written: -1, rankHot: -1, compare: [] as number[], arrows: [] as { from: number; to: number }[], callout: null };
  const snap = (p: Partial<State>): State => structuredClone({ n, parent, rank, log, opIndex, ...blank, ...p });
  const V = (o: Record<string, number | string | undefined>) => ({ op: opIndex >= 0 ? opText(ops[opIndex]) : undefined, x: undefined, 'parent[x]': undefined, root: undefined, ...o });

  yield {
    state: snap({}),
    line: 'init',
    note: `Start with **${n}** separate sets: every element is its own root (\`parent[i] = i\`) and every tree has rank 0.`,
    vars: V({}),
    phase: 'init',
  };

  /** find(x) with path compression, one frame per pointer hop / rewrite. Returns the root. */
  function* find(x: number, who: string): Generator<Frame<State>, number> {
    const path: number[] = [x];
    while (parent[path[path.length - 1]] !== path[path.length - 1]) {
      const v = path[path.length - 1];
      yield {
        state: snap({ cur: v, path: [...path] }),
        line: 'climb',
        note: `${path.length === 1 ? `${who}: start at **${v}**. ` : ''}\`parent[${v}] = ${parent[v]}\` ≠ ${v}, so ${v} is not a root — climb to **${parent[v]}**.`,
        vars: V({ x: v, 'parent[x]': parent[v] }),
        phase: opText(ops[opIndex]),
      };
      path.push(parent[v]);
    }
    const r = path[path.length - 1];
    const fix = path.slice(0, -1).filter((v) => parent[v] !== r).reverse(); // recursion unwinds top-down
    yield {
      state: snap({ cur: r, path: [...path], root: r, arrows: fix.map((v) => ({ from: v, to: r })) }),
      line: 'root',
      note:
        `${path.length === 1 ? `${who}: ` : ''}\`parent[${r}] = ${r}\` — **${r}** is the root, the representative of this set.` +
        (fix.length ? ` On the way back, re-point ${fix.map((v) => `**${v}**`).join(', ')} straight at ${r} so later finds are instant.` : path.length > 1 ? ' The path is already as short as it can be.' : ''),
      vars: V({ x: r, 'parent[x]': r, root: r }),
      phase: opText(ops[opIndex]),
    };
    for (let k = 0; k < fix.length; k++) {
      const v = fix[k];
      const old = parent[v];
      parent[v] = r;
      yield {
        state: snap({ cur: v, path: [...path], root: r, written: v, arrows: fix.slice(k + 1).map((u) => ({ from: u, to: r })) }),
        line: 'compress',
        note: `Path compression: \`parent[${v}] = ${r}\` (was ${old}). Node ${v} — and everything below it — now hangs directly off the root.`,
        vars: V({ x: v, 'parent[x]': r, root: r }),
        phase: opText(ops[opIndex]),
      };
    }
    return r;
  }

  for (opIndex = 0; opIndex < ops.length; opIndex++) {
    const o = ops[opIndex];
    const ph = opText(o);
    const id = opIndex;
    if (o.op === 'find') {
      yield { state: snap({ cur: o.a }), line: 'find', note: `**find(${o.a})**: which set does ${o.a} belong to? Follow parent pointers up to the root.`, vars: V({ x: o.a }), phase: ph };
      const r = yield* find(o.a, `find(${o.a})`);
      log.push({ id, text: `find(${o.a}) = ${r}`, tone: 'found' });
      yield {
        state: snap({ root: r, cur: o.a, callout: { text: `find(${o.a}) = ${r}`, tone: 'found' } }),
        line: 'root',
        note: `\`find(${o.a})\` returns **${r}** — every member of this set reports the same representative.`,
        vars: V({ x: o.a, root: r }),
        phase: ph,
      };
    } else if (o.op === 'connected') {
      const b = o.b!;
      yield { state: snap({ cur: o.a }), line: 'conn', note: `**connected(${o.a}, ${b})**: two elements are in the same set exactly when they have the same root. Find both.`, vars: V({ x: o.a }), phase: ph };
      const ra = yield* find(o.a, `find(${o.a})`);
      const rb = yield* find(b, `find(${b})`);
      const yes = ra === rb;
      log.push({ id, text: `conn(${o.a}, ${b}) ${yes ? '✓' : '✗'}`, tone: yes ? 'found' : 'danger' });
      yield {
        state: snap({ compare: [ra, rb], root: yes ? ra : -1, callout: { text: yes ? `${o.a} ~ ${b}: connected` : `${o.a} ≁ ${b}: not connected`, tone: yes ? 'found' : 'danger' } }),
        line: 'conn',
        note: yes ? `Both roots are **${ra}**, so ${o.a} and ${b} are **connected**.` : `Roots differ (**${ra}** vs **${rb}**), so ${o.a} and ${b} are in **different sets**.`,
        vars: V({ root: `${ra} / ${rb}` }),
        phase: ph,
      };
    } else {
      const b = o.b!;
      yield { state: snap({ cur: o.a }), line: 'union', note: `**union(${o.a}, ${b})**: merge the sets of ${o.a} and ${b}. We can only link roots, so find both first.`, vars: V({ x: o.a }), phase: ph };
      let ra = yield* find(o.a, `find(${o.a})`);
      let rb = yield* find(b, `find(${b})`);
      if (ra === rb) {
        log.push({ id, text: `union(${o.a}, ${b}) — same`, tone: 'muted' });
        yield {
          state: snap({ root: ra, compare: [ra] }),
          line: 'same',
          note: `Both have root **${ra}** — they're already in the same set, nothing to do.`,
          vars: V({ root: ra }),
          phase: ph,
        };
        continue;
      }
      const swapped = rank[ra] < rank[rb];
      yield {
        state: snap({ compare: [ra, rb] }),
        line: 'rank',
        note:
          rank[ra] === rank[rb]
            ? `Roots **${ra}** and **${rb}** both have rank ${rank[ra]}. Either may go on top; keep **${ra}** as the new root.`
            : `Compare ranks: ${ra} has **${rank[ra]}**, ${rb} has **${rank[rb]}**. Hang the shorter tree under the taller one so the height doesn't grow.`,
        vars: V({ root: `${ra} / ${rb}` }),
        phase: ph,
      };
      if (swapped) [ra, rb] = [rb, ra];
      parent[rb] = ra;
      yield {
        state: snap({ written: rb, root: ra, compare: [ra] }),
        line: 'attach',
        note: `\`parent[${rb}] = ${ra}\` — ${rb}'s whole tree now belongs to root **${ra}**.`,
        vars: V({ x: rb, 'parent[x]': ra, root: ra }),
        phase: ph,
      };
      if (rank[ra] === rank[rb]) {
        rank[ra]++;
        yield {
          state: snap({ root: ra, rankHot: ra }),
          line: 'bump',
          note: `The two trees were equally tall, so the merged one is one level taller: \`rank[${ra}] = ${rank[ra]}\`.`,
          vars: V({ root: ra }),
          phase: ph,
        };
      }
      log.push({ id, text: `union(${o.a}, ${b})`, tone: 'done' });
    }
  }
  opIndex = ops.length;
  const sets = parent.filter((p, i) => p === i).length;
  yield {
    state: snap({}),
    line: 'init',
    note: `All ${ops.length} operations done — **${sets}** set${sets > 1 ? 's' : ''} remain. Thanks to union by rank + path compression each operation cost nearly O(1).`,
    vars: { op: undefined, x: undefined, 'parent[x]': undefined, root: undefined },
    phase: 'done',
  };
}

/* ---------------- view ---------------- */

const STYLE = `
.union-find-finger { transition: transform var(--step-ms) var(--ease-in-out); }
.union-find-finger circle { transform-box: fill-box; transform-origin: center; animation: union-find-spin 5s linear infinite; }
.union-find-arrow { stroke-dasharray: 1; animation: union-find-draw calc(var(--step-ms) * 1.2) var(--ease-out) both; }
@keyframes union-find-spin { to { transform: rotate(360deg); } }
@keyframes union-find-draw { from { stroke-dashoffset: 1; } }
@media (prefers-reduced-motion: reduce) { .union-find-finger { transition: none; } .union-find-finger circle, .union-find-arrow { animation: none; } }
`;

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const R = 20;
  const pathSet = new Set(s.path);
  const nodeTone = (i: number): Tone | undefined => {
    if (i === s.written) return 'swap';
    if (s.compare.includes(i)) return 'compare';
    if (i === s.root) return 'found';
    if (i === s.cur) return 'active';
    if (pathSet.has(i)) return 'path';
    return undefined;
  };
  const nodes: TreeNode[] = s.parent.map((_, i) => ({
    id: i,
    label: i,
    sub: s.parent[i] === i ? `rank ${s.rank[i]}` : undefined,
    tone: nodeTone(i),
    children: s.parent.map((p, j) => (p === i && j !== i ? j : -1)).filter((j) => j >= 0),
  }));
  const roots = s.parent.map((p, i) => (p === i ? i : -1)).filter((i) => i >= 0);
  const edgeTones: Record<string, Tone> = {};
  for (let k = 0; k + 1 < s.path.length; k++) {
    const c = s.path[k];
    const p = s.parent[c];
    edgeTones[`${p}-${c}`] = c === s.written ? 'swap' : 'path';
  }
  const overlay = (pos: Map<string | number, { x: number; y: number }>) => {
    const f = s.cur >= 0 ? pos.get(s.cur) : undefined;
    return (
      <g>
        <style>{STYLE}</style>
        {s.arrows.map(({ from, to }) => {
          const a = pos.get(from);
          const b = pos.get(to);
          if (!a || !b) return null;
          const side = a.x <= b.x ? -1 : 1;
          const cx = Math.min(a.x, b.x) + Math.abs(a.x - b.x) / 2 + side * 60;
          const cy = (a.y + b.y) / 2;
          return (
            <g key={`${from}-${to}`}>
              <path
                className="union-find-arrow"
                pathLength={1}
                d={`M${a.x + side * R * 0.8} ${a.y - R * 0.5} Q${cx} ${cy} ${b.x + side * R} ${b.y + R * 0.3}`}
                fill="none"
                stroke={toneFill('swap')}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle cx={b.x + side * R} cy={b.y + R * 0.3} r={3.5} fill={toneFill('swap')} />
            </g>
          );
        })}
        {f && (
          <g className="union-find-finger" style={{ transform: `translate(${f.x}px, ${f.y}px)` }}>
            <circle r={R + 6} fill="none" stroke={toneFill('active')} strokeWidth={2.2} strokeDasharray="5 4" />
          </g>
        )}
      </g>
    );
  };
  const arrTone = (i: number): Tone | undefined => nodeTone(i);
  const op = s.opIndex;
  return (
    <VizStack gap={16}>
      <VizSection label={`forest · ${roots.length} set${roots.length > 1 ? 's' : ''}`} aside={op >= 0 && s.log.length <= op ? `running op ${op + 1}` : undefined}>
        <TreeView nodes={nodes} roots={roots} edgeTones={edgeTones} nodeSize={R * 2} levelGap={70} siblingGap={16} minHeight={150} overlay={overlay} />
      </VizSection>
      <VizSection label="parent[ ]" aside="where each element points">
        <ArrayView items={s.parent} tones={arrTone} cell={42} pointers={[{ index: s.cur, label: 'x', tone: 'active' }]} />
      </VizSection>
      <VizSection label="rank[ ]" aside="upper bound on tree height (only roots matter)">
        <ArrayView items={s.rank} tones={(i) => (i === s.rankHot ? 'swap' : s.compare.includes(i) ? 'compare' : s.parent[i] !== i ? 'muted' : undefined)} cell={42} />
      </VizSection>
      <TokenStrip label="log" items={s.log} empty="no results yet" />
      <Callout show={!!s.callout} tone={s.callout?.tone ?? 'found'}>
        {s.callout?.text ?? ' '}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const dur = '4s';
  return (
    <svg viewBox="0 0 120 80">
      {/* root */}
      <circle cx={60} cy={16} r={8} fill="#c6f36b" />
      {/* chain 60,16 <- 40,40 <- 28,64 ; right child */}
      <line x1={60} y1={16} x2={84} y2={40} stroke="currentColor" strokeWidth={2} strokeOpacity={0.6} />
      <circle cx={84} cy={40} r={7} fill="currentColor" fillOpacity={0.8} />
      <line x1={60} y1={16} x2={40} y2={40} stroke="currentColor" strokeWidth={2} strokeOpacity={0.6} />
      <circle cx={40} cy={40} r={7} fill="#ffd166" />
      <line x1={40} y1={40} x2={28} y2={64} stroke="currentColor" strokeWidth={2} strokeOpacity={0.6}>
        <animate attributeName="x1" values="40;40;60;60" keyTimes="0;0.45;0.65;1" dur={dur} repeatCount="indefinite" />
        <animate attributeName="y1" values="40;40;16;16" keyTimes="0;0.45;0.65;1" dur={dur} repeatCount="indefinite" />
      </line>
      <circle cx={28} cy={64} r={7} fill="#ff5fa2">
        <animate attributeName="cx" values="28;28;18;18" keyTimes="0;0.45;0.65;1" dur={dur} repeatCount="indefinite" />
        <animate attributeName="cy" values="64;64;40;40" keyTimes="0;0.45;0.65;1" dur={dur} repeatCount="indefinite" />
      </circle>
      {/* finger climbing */}
      <circle r={11} fill="none" stroke="#f5b544" strokeWidth={1.8} strokeDasharray="4 3">
        <animate attributeName="cx" values="28;40;60;60" keyTimes="0;0.15;0.3;1" dur={dur} repeatCount="indefinite" calcMode="discrete" />
        <animate attributeName="cy" values="64;40;16;16" keyTimes="0;0.15;0.3;1" dur={dur} repeatCount="indefinite" calcMode="discrete" />
      </circle>
    </svg>
  );
}

/* ---------------- input ---------------- */

const ALIASES: Record<string, OpName> = { u: 'union', union: 'union', f: 'find', find: 'find', c: 'connected', conn: 'connected', connected: 'connected' };

function parse(text: string): Input {
  const bar = text.indexOf('|');
  if (bar < 0) throw new Error('Start with the number of elements, then "|", e.g. "8 | union 0 1, find 1".');
  const nStr = text.slice(0, bar).trim();
  const n = Number(nStr);
  if (!/^\d+$/.test(nStr) || n < 4 || n > 12) throw new Error(`The element count must be a whole number from 4 to 12 (got "${nStr || 'nothing'}").`);
  const parts = text
    .slice(bar + 1)
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('Add at least one operation after "|", e.g. "union 0 1".');
  if (parts.length > 16) throw new Error(`${parts.length} operations — keep it to 16 so the replay stays watchable.`);
  const ops = parts.map((p): Op => {
    const [name, ...args] = p.split(/[\s()]+/).filter(Boolean);
    const op = ALIASES[name?.toLowerCase() ?? ''];
    if (!op) throw new Error(`"${p}": unknown operation "${name}". Use union, find or connected (or u / f / c).`);
    const want = op === 'find' ? 1 : 2;
    if (args.length !== want) throw new Error(`"${p}": ${op} takes ${want} element${want > 1 ? 's' : ''}.`);
    const nums = args.map((s) => {
      const v = Number(s);
      if (!/^\d+$/.test(s)) throw new Error(`"${p}": "${s}" is not an element number.`);
      if (v >= n) throw new Error(`"${p}": element ${v} doesn't exist — elements are 0 to ${n - 1}.`);
      return v;
    });
    return op === 'find' ? { op, a: nums[0] } : { op, a: nums[0], b: nums[1] };
  });
  return { n, ops };
}

const format = (v: Input) => `${v.n} | ${v.ops.map((o) => (o.op === 'find' ? `find ${o.a}` : `${o.op} ${o.a} ${o.b}`)).join(', ')}`;

export default defineAlgorithm<Input, State>({
  id: 'union-find',
  name: 'Union–Find (DSU)',
  category: 'basic',
  order: 3,
  tagline: 'Track which elements belong together with a forest of parent pointers.',
  description:
    'A **disjoint-set union** keeps elements in groups. Each group is a tree; its root is the group’s name. `find` follows `parent` pointers to the root, `union` links two roots. Two tricks make it almost O(1): **union by rank** hangs the shorter tree under the taller, and **path compression** re-points every node on a find path straight at the root.',
  howItWorks: [
    'Initially `parent[i] = i`: every element is its own one-node tree.',
    '`find(x)`: climb parent pointers until a node points at itself — that root names the set.',
    'On the way back, point every visited node directly at the root (path compression).',
    '`union(a, b)`: find both roots; attach the lower-rank root under the higher one (bump rank on a tie).',
    '`connected(a, b)` is simply `find(a) === find(b)`.',
  ],
  complexity: { time: 'O(α(n)) amortised per op', space: 'O(n)', note: 'α is the inverse Ackermann function — at most 4 for any n you will ever meet.' },
  code: {
    js: `
class DSU {
  constructor(n) { //@init
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x) { //@find
    if (this.parent[x] !== x) //@climb
      this.parent[x] = this.find(this.parent[x]); //@compress
    return this.parent[x]; //@root
  }
  union(a, b) { //@union
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false; //@same
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra]; //@rank
    this.parent[rb] = ra; //@attach
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++; //@bump
    return true;
  }
  connected(a, b) { //@conn
    return this.find(a) === this.find(b);
  }
}`,
    py: `
class DSU:
    def __init__(self, n): #@init
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x): #@find
        if self.parent[x] != x: #@climb
            self.parent[x] = self.find(self.parent[x]) #@compress
        return self.parent[x] #@root

    def union(self, a, b): #@union
        ra, rb = self.find(a), self.find(b)
        if ra == rb: #@same
            return False
        if self.rank[ra] < self.rank[rb]: #@rank
            ra, rb = rb, ra
        self.parent[rb] = ra #@attach
        if self.rank[ra] == self.rank[rb]: #@bump
            self.rank[ra] += 1
        return True

    def connected(self, a, b): #@conn
        return self.find(a) == self.find(b)`,
  },
  input: {
    default: parse('10 | union 0 1, union 2 3, union 0 2, union 4 5, union 6 7, union 4 6, union 3 7, find 6, union 8 9, connected 5 1, connected 1 8'),
    presets: [
      { name: 'Chain of unions (rank keeps it flat)', value: parse('8 | union 0 1, union 1 2, union 2 3, union 3 4, union 4 5, union 5 6, union 6 7, find 7') },
      { name: 'Redundant union', value: parse('6 | union 0 1, union 1 2, union 0 2, connected 2 0, connected 3 4') },
      { name: 'Only queries (all singletons)', value: parse('4 | find 0, find 3, connected 1 2') },
      { name: 'Two towers merge', value: parse('8 | u 0 1, u 2 3, u 0 2, u 4 5, u 6 7, u 4 6, u 0 4, f 7, f 3, c 5 1') },
    ],
    random: () => {
      const n = randInt(6, 12);
      const k = randInt(6, 12);
      const ops: Op[] = [];
      for (let i = 0; i < k; i++) {
        const a = randInt(0, n - 1);
        let b = randInt(0, n - 1);
        if (b === a) b = (a + 1) % n;
        const roll = Math.random();
        ops.push(roll < 0.65 ? { op: 'union', a, b } : roll < 0.82 ? { op: 'find', a } : { op: 'connected', a, b });
      }
      return { n, ops };
    },
    format,
    parse,
    placeholder: '8 | union 0 1, union 2 3, find 3, connected 0 2',
    hint: 'Element count (4–12), then "|" and up to 16 comma-separated operations: "union a b", "find a", "connected a b" (short forms u / f / c work). Elements are 0 … n−1.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current node (x)' },
    { tone: 'path', label: 'find path' },
    { tone: 'found', label: 'root / representative' },
    { tone: 'swap', label: 'pointer rewritten' },
    { tone: 'compare', label: 'roots compared' },
  ],
  Glyph,
});
