import type { Cell } from '@/viz';
import { defineAlgorithm, type EditorProps, type Frame } from '@/core/types';
import { randInt } from '@/core/utils';
import { Callout, GridEditor, GridView, StatRow, TokenStrip, VizStack, toneFill } from '@/viz';
import { CellOutlines, DIRS, DIR_NAME, Splashes, cellKey, cellTokens, editorRow } from './_graphsB';

type Method = 'bfs' | 'dfs';

interface Input {
  grid: number[][]; // colour indices 0..4
  seed: Cell;
  newColor: number;
  method: Method;
}

interface State {
  grid: number[][];
  frontier: Cell[]; // queue (bfs, front first) or stack (dfs, top first)
  cur: Cell | null;
  fresh: Cell[]; // painted in this frame
  painted: number;
  stage: 'setup' | 'fill' | 'same' | 'done';
}

const COLORS = [
  { value: 0, label: 'ink', color: '#2b3752' },
  { value: 1, label: 'sky', color: '#6cb6ff' },
  { value: 2, label: 'mint', color: '#5fd3a5' },
  { value: 3, label: 'coral', color: '#ff6b5b' },
  { value: 4, label: 'gold', color: '#ffd166' },
];
const colorName = (v: number) => COLORS[v]?.label ?? `#${v}`;
const SIZE = 36;
const FRAME_BUDGET = 380;

function* run({ grid: g0, seed, newColor, method }: Input): Generator<Frame<State>> {
  const grid = g0.map((row) => [...row]);
  const R = grid.length;
  const C = grid[0]?.length ?? 0;
  const [sr, sc] = seed;
  const old = grid[sr][sc];
  const box = method === 'bfs' ? 'queue' : 'stack';
  const frontier: Cell[] = [];
  let painted = 0;
  const snap = (stage: State['stage'], cur: Cell | null, fresh: Cell[] = []): State => ({
    grid: grid.map((row) => [...row]),
    frontier: method === 'bfs' ? frontier.map((c) => [...c] as Cell) : [...frontier].reverse().map((c) => [...c] as Cell),
    cur: cur ? [...cur] : null,
    fresh: fresh.map((c) => [...c] as Cell),
    painted,
    stage,
  });
  const vars = (cur: Cell | null, nb?: Cell) => ({ old: colorName(old), newColor: colorName(newColor), cell: cur ? `${cur[0]},${cur[1]}` : undefined, neighbour: nb ? `${nb[0]},${nb[1]}` : undefined, [box]: frontier.length, painted });

  yield {
    state: snap('setup', seed),
    line: 'fn',
    note: `Paint bucket at (**${sr},${sc}**): the clicked cell is **${colorName(old)}**, so every ${colorName(old)} cell *connected* to it (up/down/left/right) should become **${colorName(newColor)}**.`,
    vars: vars(seed),
    phase: 'setup',
  };
  if (old === newColor) {
    yield {
      state: snap('same', seed),
      line: 'same',
      note: `The seed is already **${colorName(newColor)}** — nothing to do. (Without this check the fill would loop forever: painted cells would still match the "old" colour.)`,
      vars: vars(seed),
      phase: 'done',
    };
    return;
  }

  // Count region first to choose between detailed and batched narration (keeps frames ≤ ~400).
  let region = 0;
  {
    const seen = new Set([cellKey(seed)]);
    const st: Cell[] = [seed];
    while (st.length) {
      const [r, c] = st.pop()!;
      region++;
      for (const [dr, dc] of DIRS) {
        const n: Cell = [r + dr, c + dc];
        if (n[0] >= 0 && n[0] < R && n[1] >= 0 && n[1] < C && grid[n[0]][n[1]] === old && !seen.has(cellKey(n))) {
          seen.add(cellKey(n));
          st.push(n);
        }
      }
    }
  }
  const batched = region * 2 + 4 > FRAME_BUDGET;

  grid[sr][sc] = newColor;
  painted = 1;
  frontier.push(seed);
  yield {
    state: snap('fill', seed, [seed]),
    line: 'seed',
    note: `Paint the seed **${colorName(newColor)}** and put it in the ${box}. Painting *when a cell is added* (not when it's taken out) guarantees no cell is ever added twice.${method === 'dfs' ? ' This run uses a **stack** (DFS): the newest cell is taken first, so the paint snakes deep before spreading.' : ' A **queue** (BFS) takes the oldest cell first, so the paint spreads in rings.'}`,
    vars: vars(seed),
    phase: 'fill',
  };

  while (frontier.length) {
    const cur = (method === 'bfs' ? frontier.shift() : frontier.pop())!;
    const [r, c] = cur;
    const found: Cell[] = [];
    const dirs: string[] = [];
    DIRS.forEach(([dr, dc], k) => {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < R && nc >= 0 && nc < C && grid[nr][nc] === old) {
        found.push([nr, nc]);
        dirs.push(DIR_NAME[k]);
      }
    });
    if (batched) {
      for (const n of found) {
        grid[n[0]][n[1]] = newColor;
        painted++;
        frontier.push(n);
      }
      yield {
        state: snap('fill', cur, found),
        line: found.length ? ['pop', 'check', 'paint', 'push'] : ['pop', 'check'],
        note: found.length
          ? `Take (**${r},${c}**) from the ${box}; ${found.length} neighbour${found.length > 1 ? 's are' : ' is'} still ${colorName(old)} (${dirs.join(', ')}) → painted and added.`
          : `Take (**${r},${c}**) from the ${box}; no ${colorName(old)} neighbours left around it — a dead end.`,
        vars: vars(cur),
        phase: 'fill',
      };
      continue;
    }
    yield {
      state: snap('fill', cur),
      line: 'pop',
      note: found.length
        ? `Take (**${r},${c}**) from the ${method === 'bfs' ? 'front of the queue' : 'top of the stack'} and look at its 4 neighbours: ${found.length} of them ${found.length > 1 ? 'are' : 'is'} still **${colorName(old)}**.`
        : `Take (**${r},${c}**) from the ${method === 'bfs' ? 'front of the queue' : 'top of the stack'}. Its neighbours are walls of another colour, the edge, or already painted — nothing to add.`,
      vars: vars(cur),
      phase: 'fill',
    };
    for (let k = 0; k < found.length; k++) {
      const n = found[k];
      grid[n[0]][n[1]] = newColor;
      painted++;
      frontier.push(n);
      yield {
        state: snap('fill', cur, [n]),
        line: ['check', 'paint', 'push'],
        note: `Neighbour ${dirs[k]} (**${n[0]},${n[1]}**) is ${colorName(old)} → paint it ${colorName(newColor)} and push it onto the ${box}.`,
        vars: vars(cur, n),
        phase: 'fill',
      };
    }
  }

  let leftover = 0;
  for (const row of grid) for (const v of row) if (v === old) leftover++;
  yield {
    state: snap('done', null),
    line: 'done',
    note: `The ${box} is empty — the fill is complete: **${painted}** cell${painted > 1 ? 's' : ''} repainted.${leftover ? ` ${leftover} other ${colorName(old)} cell${leftover > 1 ? 's stay' : ' stays'} untouched: not connected to the seed.` : ''}`,
    vars: vars(null),
    phase: 'done',
  };
}

function View({ frame, input }: { frame: Frame<State>; input: Input }) {
  const s = frame.state;
  const rows = s.grid.length;
  const cols = s.grid[0]?.length ?? 0;
  const fresh = new Set(s.fresh.map(cellKey));
  const box = input.method === 'bfs' ? 'queue' : 'stack';
  const paint = COLORS[input.newColor]?.color ?? '#fff';
  return (
    <VizStack gap={16}>
      <StatRow
        stats={[
          { label: 'painted', value: s.painted, tone: 'done' },
          { label: `${box} size`, value: s.frontier.length, tone: 'frontier' },
          { label: 'method', value: input.method.toUpperCase() },
        ]}
      />
      <GridView
        rows={rows}
        cols={cols}
        size={SIZE}
        cell={(r, c) => ({ fill: COLORS[s.grid[r][c]]?.color, pulse: fresh.has(`${r},${c}`) })}
        cursor={s.cur}
        markers={[{ cell: input.seed, label: '◎', color: '#ece6d6' }]}
        overlay={
          <>
            <CellOutlines cells={s.frontier} size={SIZE} color={toneFill('frontier')} prefix="flood-fill" numbered={s.frontier.length <= 30} />
            <Splashes cells={s.fresh} size={SIZE} color={paint} prefix="flood-fill" stamp={s.painted} />
          </>
        }
      />
      <TokenStrip label={input.method === 'bfs' ? 'queue →' : 'stack ↓'} items={cellTokens(s.frontier, 'frontier')} empty="empty" />
      <Callout show={s.stage === 'done' || s.stage === 'same'} tone={s.stage === 'same' ? 'active' : 'found'}>
        {s.stage === 'same' ? 'already that colour' : `${s.painted} cells filled`}
      </Callout>
    </VizStack>
  );
}

/* ---------- input editor ---------- */

function blobs(rows: number, cols: number): number[][] {
  let g = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() < 0.55 ? randInt(1, 3) : 0)));
  for (let pass = 0; pass < 3; pass++) {
    g = g.map((row, r) =>
      row.map((v, c) => {
        const count = new Map<number, number>();
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const x = g[r + dr]?.[c + dc];
            if (x !== undefined) count.set(x, (count.get(x) ?? 0) + 1);
          }
        let best = v;
        let bestN = 0;
        for (const [k, n] of count) if (n > bestN || (n === bestN && k === v)) [best, bestN] = [k, n];
        return best;
      }),
    );
  }
  return g;
}

function clampSeed(seed: Cell, g: number[][]): Cell {
  return [Math.min(seed[0], g.length - 1), Math.min(seed[1], (g[0]?.length ?? 1) - 1)];
}

function Editor({ value, onChange }: EditorProps<Input>) {
  const set = (p: Partial<Input>) => onChange({ ...value, ...p });
  return (
    <div>
      <div style={editorRow}>
        <span className="field-label">Fill with</span>
        <div className="gde-palette">
          {COLORS.map((p) => (
            <button key={p.value} className={`swatch ${value.newColor === p.value ? 'on' : ''}`} onClick={() => set({ newColor: p.value })}>
              <i style={{ background: p.color }} />
              {p.label}
            </button>
          ))}
        </div>
        <span className="field-label">Spread with</span>
        <div className="seg seg-sm">
          {(['bfs', 'dfs'] as Method[]).map((m) => (
            <button key={m} className={`seg-btn ${value.method === m ? 'on' : ''}`} onClick={() => set({ method: m })}>
              {m === 'bfs' ? 'BFS · queue' : 'DFS · stack'}
            </button>
          ))}
        </div>
      </div>
      <GridEditor
        grid={value.grid}
        onGrid={(grid) => set({ grid, seed: clampSeed(value.seed, grid) })}
        palette={COLORS}
        markers={[{ key: 'seed', label: '◎', name: 'Bucket (seed)', color: '#ece6d6', cell: value.seed }]}
        onMarker={(_, cell) => set({ seed: cell })}
        minSize={3}
        maxSize={14}
        actions={[
          { label: 'Random blobs', run: () => { const grid = blobs(value.grid.length, value.grid[0]?.length ?? 10); set({ grid, seed: clampSeed(value.seed, grid) }); } },
          { label: 'Clear', run: () => set({ grid: value.grid.map((row) => row.map(() => 0)) }) },
        ]}
      />
      {value.grid[value.seed[0]]?.[value.seed[1]] === value.newColor && (
        <p className="field-hint">The seed cell already has the fill colour — the run will stop immediately (a useful edge case!).</p>
      )}
    </div>
  );
}

function Glyph() {
  const cols = 6;
  const rows = 4;
  const wall = new Set(['0,3', '1,3', '3,1', '2,5']);
  const seed = [1, 1];
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = `${r},${c}`;
      const x = 12 + c * 16.5;
      const y = 6 + r * 17;
      if (wall.has(k)) {
        cells.push(<rect key={k} x={x} y={y} width={14} height={14} rx={3} fill="#ff6b5b" opacity={0.75} />);
        continue;
      }
      const d = Math.abs(r - seed[0]) + Math.abs(c - seed[1]) + (c > 3 && r < 2 ? 2 : 0);
      const t = Math.min(0.8, 0.05 + d * 0.1);
      cells.push(
        <rect key={k} x={x} y={y} width={14} height={14} rx={3} fill="#2b3752" stroke="currentColor" strokeOpacity={0.35}>
          <animate attributeName="fill" values="#2b3752;#2b3752;#ffd166;#ffd166;#2b3752" keyTimes={`0;${t.toFixed(2)};${(t + 0.03).toFixed(2)};0.92;1`} dur="3.6s" repeatCount="indefinite" />
        </rect>,
      );
    }
  return (
    <svg viewBox="0 0 120 80">
      {cells}
      <circle cx={12 + seed[1] * 16.5 + 7} cy={6 + seed[0] * 17 + 7} r={3} fill="currentColor" />
    </svg>
  );
}

const g = (rows: string[]) => rows.map((row) => row.split('').map(Number));

const LAKE: Input = {
  grid: g([
    '2222000033',
    '2211110033',
    '2111111003',
    '0111221100',
    '0112222110',
    '0111221110',
    '0011111100',
    '3001111000',
    '3300110044',
    '3330000444',
  ]),
  seed: [4, 2],
  newColor: 4,
  method: 'bfs',
};

export default defineAlgorithm<Input, State>({
  id: 'flood-fill',
  name: 'Flood Fill',
  category: 'graphs',
  order: 6,
  tagline: 'The paint bucket tool: recolour a connected region by spreading cell to cell.',
  description:
    'Every paint program\'s **bucket tool** is a graph search in disguise: cells are nodes, and two cells are connected when they touch **and** share the old colour. Starting from the clicked cell, repaint it and push it into a **queue** (BFS) or **stack** (DFS); repeatedly take a cell out and repaint & push each matching neighbour. Toggle the method to compare how the paint spreads.',
  howItWorks: [
    'Remember the **old** colour of the clicked cell; stop if it already equals the new colour.',
    'Paint the seed and put it in the queue (or stack).',
    'Take a cell out; each of its 4 neighbours with the old colour gets painted **and** added.',
    'Painting on insertion means a cell is never added twice. Stop when the container is empty.',
  ],
  complexity: { time: 'O(R·C)', space: 'O(R·C)', note: 'Each cell is painted and queued at most once. BFS spreads in diamond-shaped rings; DFS snakes along one corridor first — same result, different path.' },
  code: {
    js: `
function floodFill(grid, sr, sc, newColor) { //@fn
  const old = grid[sr][sc];
  if (old === newColor) return grid; //@same
  const queue = [[sr, sc]]; // DFS: use it as a stack
  grid[sr][sc] = newColor; //@seed
  while (queue.length) {
    const [r, c] = queue.shift(); // DFS: queue.pop() //@pop
    for (const [dr, dc] of [[-1,0],[0,1],[1,0],[0,-1]]) {
      const nr = r + dr, nc = c + dc;
      if (grid[nr]?.[nc] === old) { //@check
        grid[nr][nc] = newColor; //@paint
        queue.push([nr, nc]); //@push
      }
    }
  }
  return grid; //@done
}`,
    py: `
from collections import deque

def flood_fill(grid, sr, sc, new_color): #@fn
    old = grid[sr][sc]
    if old == new_color: return grid #@same
    queue = deque([(sr, sc)])  # DFS: use a list as a stack
    grid[sr][sc] = new_color #@seed
    R, C = len(grid), len(grid[0])
    while queue:
        r, c = queue.popleft()  # DFS: queue.pop() #@pop
        for dr, dc in ((-1, 0), (0, 1), (1, 0), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] == old: #@check
                grid[nr][nc] = new_color #@paint
                queue.append((nr, nc)) #@push
    return grid #@done`,
  },
  input: {
    default: LAKE,
    presets: [
      { name: 'Lake with an island', value: LAKE },
      { name: 'Same lake, DFS', value: { ...LAKE, method: 'dfs' } },
      {
        name: 'Spiral corridor',
        value: {
          grid: g(['1111111111', '0000000001', '1111111101', '1000000101', '1011110101', '1010010101', '1010000101', '1011111101', '1000000001', '1111111111']),
          seed: [0, 0],
          newColor: 3,
          method: 'bfs',
        },
      },
      { name: 'Already that colour', value: { ...LAKE, newColor: 1, seed: [2, 2] } },
    ],
    random: () => {
      const rows = randInt(7, 12);
      const cols = randInt(7, 12);
      const grid = blobs(rows, cols);
      const seed: Cell = [randInt(0, rows - 1), randInt(0, cols - 1)];
      const old = grid[seed[0]][seed[1]];
      const newColor = Math.random() < 0.08 ? old : [1, 2, 3, 4, 0].filter((v) => v !== old)[randInt(0, 3)];
      return { grid, seed, newColor, method: Math.random() < 0.5 ? 'bfs' : 'dfs' };
    },
    Editor,
    hint: 'Paint the grid (3–14 per side), drop the bucket, pick the fill colour and BFS or DFS.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'cell being expanded' },
    { tone: 'frontier', label: 'waiting in queue / stack (dashed)' },
  ],
  Glyph,
});
