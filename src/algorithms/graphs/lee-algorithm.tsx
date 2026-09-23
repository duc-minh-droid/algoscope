import type { Cell } from '@/viz';
import { defineAlgorithm, type EditorProps, type Frame } from '@/core/types';
import { randInt, shuffle } from '@/core/utils';
import { Callout, GridEditor, GridView, StatRow, TokenStrip, VizStack, toneFill } from '@/viz';
import { DIRS, Splashes, cellKey, cellTokens, lerpHex } from './_graphsB';

interface Input {
  grid: number[][]; // 0 open, 1 wall
  start: Cell;
  end: Cell;
}

interface State {
  dist: number[][]; // -1 = not reached yet
  wave: number;
  front: Cell[]; // cells labelled in this frame
  cur: Cell | null;
  path: Cell[]; // backtracked cells (from E towards S)
  stage: 'setup' | 'wave' | 'reached' | 'fail' | 'back' | 'done';
  maxD: number; // final largest label, fixed for a stable colour gradient
  labelled: number;
}

const DETAIL_CELLS = 10; // first labels shown one at a time, to teach the idea

const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const fmt = (c: Cell) => `(${c[0]},${c[1]})`;

function* run({ grid: g0, start, end }: Input): Generator<Frame<State>> {
  const R = g0.length;
  const C = g0[0]?.length ?? 0;
  const open = (r: number, c: number) => r >= 0 && r < R && c >= 0 && c < C && (g0[r][c] === 0 || same([r, c], start) || same([r, c], end));

  // Pre-compute the BFS layers (with the cell that labelled each one) so the colour gradient is stable.
  const full = g0.map((row) => row.map(() => -1));
  full[start[0]][start[1]] = 0;
  const layers: { cell: Cell; from: Cell }[][] = [[{ cell: start, from: start }]];
  while (full[end[0]][end[1]] < 0) {
    const next: { cell: Cell; from: Cell }[] = [];
    for (const { cell } of layers[layers.length - 1])
      for (const [dr, dc] of DIRS) {
        const n: Cell = [cell[0] + dr, cell[1] + dc];
        if (open(n[0], n[1]) && full[n[0]][n[1]] < 0) {
          full[n[0]][n[1]] = layers.length;
          next.push({ cell: n, from: cell });
        }
      }
    if (!next.length) break;
    layers.push(next);
  }
  const maxD = layers.length - 1;
  const reached = full[end[0]][end[1]] >= 0;

  const dist = g0.map((row) => row.map(() => -1));
  let labelled = 0;
  const path: Cell[] = [];
  const snap = (stage: State['stage'], wave: number, front: Cell[], cur: Cell | null): State => ({
    dist: dist.map((row) => [...row]),
    wave,
    front: front.map((c) => [...c] as Cell),
    cur: cur ? [...cur] : null,
    path: path.map((c) => [...c] as Cell),
    stage,
    maxD,
    labelled,
  });
  const vars = (wave: number, cell?: Cell, extra: Record<string, number | string | undefined> = {}) => ({
    wave,
    cell: cell ? `${cell[0]},${cell[1]}` : undefined,
    'dist[cell]': cell ? dist[cell[0]][cell[1]] : undefined,
    labelled,
    ...extra,
  });

  yield {
    state: snap('setup', 0, [], start),
    line: 'fn',
    note: `Find the shortest route from **S** ${fmt(start)} to **E** ${fmt(end)} through open cells, moving up/down/left/right. Lee's trick: drop a pebble at S and let a **wave** ripple outward, writing on every cell how many steps it took to get there.`,
    vars: vars(0, start),
    phase: 'wave expansion',
  };
  dist[start[0]][start[1]] = 0;
  labelled = 1;
  yield {
    state: snap('wave', 0, [start], start),
    line: 'init',
    note: 'S is **0** steps from itself. Every other cell is still unmarked (−1).',
    vars: vars(0, start),
    phase: 'wave expansion',
  };

  let detailLeft = DETAIL_CELLS;
  for (let k = 1; k < layers.length; k++) {
    const layer = layers[k];
    const shown: Cell[] = [];
    let i = 0;
    // teaching frames: one label at a time for the first few cells
    for (; i < layer.length && detailLeft > 0 && k <= 2; i++, detailLeft--) {
      const { cell, from } = layer[i];
      dist[cell[0]][cell[1]] = k;
      labelled++;
      shown.push(cell);
      yield {
        state: snap('wave', k, [cell], from),
        line: ['expand', 'check', 'label'],
        note: `From ${fmt(from)} (labelled **${k - 1}**), neighbour ${fmt(cell)} is open and unmarked → it is one step further: write **${k}**.${k === 1 && i === 0 ? ' Walls and already-marked cells are skipped — a mark never changes, because the first wave to arrive is the shortest.' : ''}`,
        vars: vars(k, cell),
        phase: 'wave expansion',
      };
    }
    const rest = layer.slice(i);
    if (!rest.length && shown.length) {
      yield {
        state: snap('wave', k, shown, null),
        line: 'next',
        note: `Wave **${k}** is complete: all ${layer.length} cell${layer.length > 1 ? 's' : ''} exactly ${k} step${k > 1 ? 's' : ''} from S are marked. The new wave becomes the source of the next ripple.`,
        vars: vars(k),
        phase: 'wave expansion',
      };
      continue;
    }
    for (const { cell } of rest) {
      dist[cell[0]][cell[1]] = k;
      labelled++;
    }
    const all = layer.map((x) => x.cell);
    yield {
      state: snap('wave', k, all, null),
      line: ['wave', 'label', 'next'],
      note: shown.length
        ? `…and the rest of wave **${k}** at once: ${layer.length} cells in total are exactly **${k}** steps from S.`
        : `Wave **${k}**: every open, unmarked neighbour of a "${k - 1}" cell gets **${k}** — ${layer.length} new cell${layer.length > 1 ? 's' : ''}. All distance-${k} cells are found before any distance-${k + 1} cell.`,
      vars: vars(k),
      phase: 'wave expansion',
    };
  }

  if (!reached) {
    yield {
      state: snap('fail', maxD, [], null),
      line: 'fail',
      note: `The wave died out after **${maxD}** step${maxD === 1 ? '' : 's'} (${labelled} cells marked) without touching E. Walls seal E off — **no path exists**.`,
      vars: vars(maxD),
      phase: 'unreachable',
    };
    return;
  }

  const D = full[end[0]][end[1]];
  yield {
    state: snap('reached', D, D ? [end] : [], end),
    line: 'wave',
    note: D
      ? `The wave touched **E** with label **${D}** — so the shortest path is exactly **${D}** steps. No need to spread further; now we walk back along the numbers.`
      : 'S and E are the same cell — the shortest path has length **0**.',
    vars: vars(D, end, { 'path length': D }),
    phase: 'backtrack',
  };

  path.push(end);
  let cur = end;
  yield {
    state: snap('back', D, [], cur),
    line: 'back',
    note: `Backtrack from E: from a cell labelled **d**, some neighbour must be labelled **d − 1** (that's how the wave got here). Repeatedly step to it until we reach 0.`,
    vars: vars(D, cur, { 'path length': D }),
    phase: 'backtrack',
  };
  while (dist[cur[0]][cur[1]] > 0) {
    const d = dist[cur[0]][cur[1]];
    const nb = DIRS.map(([dr, dc]) => [cur[0] + dr, cur[1] + dc] as Cell).find(([r, c]) => r >= 0 && r < R && c >= 0 && c < C && dist[r][c] === d - 1)!;
    cur = nb;
    path.push(cur);
    yield {
      state: snap('back', D, [], cur),
      line: 'step',
      note:
        d - 1 === 0
          ? `Step to ${fmt(cur)} labelled **0** — that's S. The route is complete.`
          : `At **${d}**: neighbour ${fmt(cur)} carries **${d - 1}**, so it lies on a shortest route. Step there.`,
      vars: vars(D, cur, { 'path length': D }),
      phase: 'backtrack',
    };
  }
  yield {
    state: snap('done', D, [], null),
    line: 'done',
    note: `Reverse the walk and we have it: a shortest path of **${D}** step${D === 1 ? '' : 's'} from S to E, found by touching ${labelled} cells.`,
    vars: vars(D, undefined, { 'path length': D }),
    phase: 'backtrack',
  };
}

const LOW = '#1f4f80'; // deep sky
const HIGH = '#51399a'; // deep violet

function View({ frame, input }: { frame: Frame<State>; input: Input }) {
  const s = frame.state;
  const rows = input.grid.length;
  const cols = input.grid[0]?.length ?? 0;
  const size = Math.max(26, Math.min(40, Math.floor(560 / Math.max(rows, cols))));
  const front = new Set(s.front.map(cellKey));
  const onPath = new Set(s.path.map(cellKey));
  const isEnd = (r: number, c: number) => (r === input.start[0] && c === input.start[1]) || (r === input.end[0] && c === input.end[1]);
  const backing = s.stage === 'back' || s.stage === 'done';
  return (
    <VizStack gap={16}>
      <StatRow
        stats={[
          { label: 'wave', value: s.wave, tone: 'frontier' },
          { label: 'cells marked', value: s.labelled },
          { label: 'path length', value: s.stage === 'fail' ? '—' : backing || s.stage === 'reached' ? s.wave : '?', tone: 'path' },
        ]}
      />
      <GridView
        rows={rows}
        cols={cols}
        size={size}
        cell={(r, c) => {
          if (input.grid[r][c] === 1 && !isEnd(r, c)) return { wall: true };
          const d = s.dist[r][c];
          const k = `${r},${c}`;
          if (d < 0) return {};
          if (onPath.has(k)) return { tone: 'path', label: d, pulse: s.cur !== null && k === cellKey(s.cur) };
          if (front.has(k)) return { tone: 'frontier', label: d, pulse: true };
          const t = s.maxD ? d / s.maxD : 0;
          return { fill: backing ? lerpHex(lerpHex(LOW, HIGH, t), '#131b2b', 0.45) : lerpHex(LOW, HIGH, t), label: d };
        }}
        path={s.stage === 'done' && s.path.length > 1 ? [...s.path].reverse() : undefined}
        cursor={s.cur}
        cursorTone={backing ? 'path' : 'active'}
        markers={[
          { cell: input.start, label: 'S', color: '#5fd3a5' },
          ...(same(input.start, input.end) ? [] : [{ cell: input.end, label: 'E', color: '#ff6b5b' }]),
        ]}
        overlay={<Splashes cells={s.front.length <= 40 ? s.front : []} size={size} color={toneFill('frontier')} prefix="lee-algorithm" stamp={s.labelled * 1000 + s.wave} />}
      />
      <TokenStrip
        label={backing ? 'path ←' : 'wave'}
        items={backing ? cellTokens(s.path, 'path', 16, 'path') : cellTokens(s.front, 'frontier', 14, 'frontier')}
        empty={s.stage === 'fail' ? 'wave died out' : '—'}
      />
      <Callout show={s.stage === 'done' || s.stage === 'fail'} tone={s.stage === 'fail' ? 'danger' : 'found'}>
        {s.stage === 'fail' ? 'E is unreachable' : `shortest path: ${s.wave} step${s.wave === 1 ? '' : 's'}`}
      </Callout>
    </VizStack>
  );
}

/* ---------- maze generation & editor ---------- */

function randomMaze(rows: number, cols: number): Input {
  const g = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
  const inRoom = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && r % 2 === 0 && c % 2 === 0;
  const stack: Cell[] = [[0, 0]];
  g[0][0] = 0;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const opts = shuffle(DIRS).filter(([dr, dc]) => inRoom(r + dr * 2, c + dc * 2) && g[r + dr * 2][c + dc * 2] === 1);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [dr, dc] = opts[0];
    g[r + dr][c + dc] = 0;
    g[r + dr * 2][c + dc * 2] = 0;
    stack.push([r + dr * 2, c + dc * 2]);
  }
  // even sizes leave a spare last row/col: open it partially
  if (rows % 2 === 0) for (let c = 0; c < cols; c++) if (g[rows - 2][c] === 0 && Math.random() < 0.5) g[rows - 1][c] = 0;
  if (cols % 2 === 0) for (let r = 0; r < rows; r++) if (g[r][cols - 2] === 0 && Math.random() < 0.5) g[r][cols - 1] = 0;
  // knock out some walls to create loops (so several routes compete)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (g[r][c] === 1 && Math.random() < 0.12) {
        const h = g[r][c - 1] === 0 && g[r][c + 1] === 0;
        const v = g[r - 1]?.[c] === 0 && g[r + 1]?.[c] === 0;
        if (h || v) g[r][c] = 0;
      }
  const end: Cell = [rows - 1 - ((rows - 1) % 2), cols - 1 - ((cols - 1) % 2)];
  return { grid: g, start: [0, 0], end };
}

const PALETTE = [
  { value: 0, label: 'open', color: '#26324b' },
  { value: 1, label: 'wall', color: '#05070c' },
];

function Editor({ value, onChange }: EditorProps<Input>) {
  const clear = (grid: number[][], cells: Cell[]) =>
    cells.some(([r, c]) => grid[r]?.[c] === 1) ? grid.map((row, r) => row.map((v, c) => (cells.some((m) => m[0] === r && m[1] === c) ? 0 : v))) : grid;
  const clamp = (m: Cell, grid: number[][]): Cell => [Math.min(m[0], grid.length - 1), Math.min(m[1], (grid[0]?.length ?? 1) - 1)];
  return (
    <div>
      <GridEditor
        grid={value.grid}
        onGrid={(g) => {
          const start = clamp(value.start, g);
          const end = clamp(value.end, g);
          onChange({ grid: clear(g, [start, end]), start, end });
        }}
        palette={PALETTE}
        markers={[
          { key: 'start', label: 'S', name: 'Start', color: '#5fd3a5', cell: value.start },
          { key: 'end', label: 'E', name: 'End', color: '#ff6b5b', cell: value.end },
        ]}
        onMarker={(key, cell) => {
          const next = { ...value, [key]: cell } as Input;
          onChange({ ...next, grid: clear(value.grid, [cell]) });
        }}
        minSize={3}
        maxSize={16}
        actions={[
          { label: 'Random maze', run: () => onChange(randomMaze(value.grid.length, value.grid[0]?.length ?? 11)) },
          { label: 'Clear walls', run: () => onChange({ ...value, grid: value.grid.map((row) => row.map(() => 0)) }) },
        ]}
      />
      {same(value.start, value.end) && <p className="field-hint">Start and end are the same cell — the answer is a 0-step path.</p>}
    </div>
  );
}

function Glyph() {
  // 6×4 grid: a wave ripples out from the corner, then a gold path draws back
  const walls = new Set(['0,2', '1,2', '2,4', '3,4', '2,1']);
  const cells = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 6; c++) {
      const x = 10 + c * 17;
      const y = 6 + r * 17;
      const k = `${r},${c}`;
      if (walls.has(k)) {
        cells.push(<rect key={k} x={x} y={y} width={15} height={15} rx={3} fill="#05070c" stroke="currentColor" strokeOpacity={0.25} />);
        continue;
      }
      const t = Math.min(0.62, 0.04 + (r + c) * 0.075);
      cells.push(
        <rect key={k} x={x} y={y} width={15} height={15} rx={3} fill="#1b2539">
          <animate attributeName="fill" values={`#1b2539;#1b2539;#a98bff;${lerpHex('#1f4f80', '#51399a', (r + c) / 8)};${lerpHex('#1f4f80', '#51399a', (r + c) / 8)};#1b2539`} keyTimes={`0;${t.toFixed(2)};${(t + 0.03).toFixed(2)};${(t + 0.12).toFixed(2)};0.94;1`} dur="4s" repeatCount="indefinite" />
        </rect>,
      );
    }
  const c = (r: number, col: number) => `${17.5 + col * 17} ${13.5 + r * 17}`;
  const d = `M${c(3, 5)} L${c(1, 5)} L${c(1, 3)} L${c(3, 3)} L${c(3, 0)} L${c(0, 0)}`;
  return (
    <svg viewBox="0 0 120 80">
      {cells}
      <path d={d} fill="none" stroke="#ffd166" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1" keyTimes="0;0.66;0.86;0.94;1" dur="4s" repeatCount="indefinite" />
      </path>
      <circle cx={17.5} cy={13.5} r={4} fill="currentColor" />
    </svg>
  );
}

const g = (rows: string[]) => rows.map((row) => row.split('').map(Number));

const MAZE: Input = {
  grid: g([
    '0001000000010',
    '0101011111010',
    '0100000001000',
    '0111110101110',
    '0000010100000',
    '1110111101011',
    '0000100001000',
    '0110101111010',
    '0100001000010',
    '0101111011110',
    '0100000010000',
  ]),
  start: [0, 0],
  end: [10, 12],
};

export default defineAlgorithm<Input, State>({
  id: 'lee-algorithm',
  name: "Lee's Algorithm",
  category: 'graphs',
  order: 7,
  tagline: 'Shortest path in a maze: ripple a numbered wave out from the start, then walk the numbers back.',
  description:
    "Lee's algorithm (1961, for routing wires on circuit boards) is **breadth-first search on a grid**. A wave spreads from **S**, one layer per step, writing on each open cell its distance from S. The first time the wave touches **E**, that number is the shortest path length — then we **backtrack** from E, always stepping to a neighbour whose number is one smaller.",
  howItWorks: [
    'Mark S with **0**; every other cell is unmarked.',
    'Wave k: every open, unmarked neighbour of a cell marked k−1 gets **k**.',
    'Stop when E gets a mark (or the wave dies out — then E is unreachable).',
    'Backtrack from E to any neighbour marked one less, until you reach 0.',
  ],
  complexity: { time: 'O(R·C)', space: 'O(R·C)', note: 'Each cell is marked once. The path is guaranteed shortest because waves arrive in order of distance.' },
  code: {
    js: `
function lee(grid, S, E) { //@fn
  const dist = grid.map(row => row.map(() => -1));
  dist[S.r][S.c] = 0; //@init
  let wave = [S];
  while (wave.length && dist[E.r][E.c] < 0) { //@wave
    const next = [];
    for (const cell of wave) //@expand
      for (const nb of neighbours(cell))
        if (isOpen(nb) && dist[nb.r][nb.c] < 0) { //@check
          dist[nb.r][nb.c] = dist[cell.r][cell.c] + 1; //@label
          next.push(nb);
        }
    wave = next; //@next
  }
  if (dist[E.r][E.c] < 0) return null; //@fail
  const path = [E]; //@back
  let cur = E;
  while (dist[cur.r][cur.c] > 0) {
    cur = neighbours(cur).find(nb => dist[nb.r]?.[nb.c] === dist[cur.r][cur.c] - 1); //@step
    path.push(cur);
  }
  return path.reverse(); //@done
}`,
    py: `
def lee(grid, S, E): #@fn
    dist = [[-1] * len(row) for row in grid]
    dist[S[0]][S[1]] = 0 #@init
    wave = [S]
    while wave and dist[E[0]][E[1]] < 0: #@wave
        nxt = []
        for cell in wave: #@expand
            for nb in neighbours(cell):
                if is_open(nb) and dist[nb[0]][nb[1]] < 0: #@check
                    dist[nb[0]][nb[1]] = dist[cell[0]][cell[1]] + 1 #@label
                    nxt.append(nb)
        wave = nxt #@next
    if dist[E[0]][E[1]] < 0: return None #@fail
    path, cur = [E], E #@back
    while dist[cur[0]][cur[1]] > 0:
        cur = next(nb for nb in neighbours(cur) #@step
                   if dist[nb[0]][nb[1]] == dist[cur[0]][cur[1]] - 1) #@step
        path.append(cur)
    return path[::-1] #@done`,
  },
  input: {
    default: MAZE,
    presets: [
      { name: 'Twisty maze', value: MAZE },
      {
        name: 'Open field',
        value: { grid: g(['00000000', '00000000', '00011000', '00010000', '00010000', '00000000', '00000000']), start: [3, 1], end: [3, 6] },
      },
      {
        name: 'Walled off (no path)',
        value: { grid: g(['0000100', '0000100', '0000111', '0000000', '0000000']), start: [4, 0], end: [0, 6] },
      },
      { name: 'Start = end', value: { grid: g(['000', '010', '000']), start: [1, 0], end: [1, 0] } },
    ],
    random: () => randomMaze(randInt(7, 15), randInt(7, 15)),
    Editor,
    hint: 'Paint walls, place S and E (3–16 cells per side), or roll a random maze.',
  },
  run,
  View,
  legend: [
    { tone: 'frontier', label: 'newest wave' },
    { tone: 'visited', label: 'marked with distance (sky → violet = near → far)' },
    { tone: 'active', label: 'expanding from' },
    { tone: 'path', label: 'shortest path' },
  ],
  Glyph,
});
