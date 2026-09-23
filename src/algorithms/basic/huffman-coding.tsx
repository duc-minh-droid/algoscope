import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt, shuffle } from '@/core/utils';
import { Callout, StatRow, TokenStrip, TreeView, VizSection, VizStack, toneFill, toneInk, type TreeNode } from '@/viz';

type Input = string;

interface HNode {
  id: number; // = tie-break sequence number (leaves first, merged nodes after)
  w: number;
  ch?: string;
  kids?: [number, number];
}

type Stage = 'count' | 'forest' | 'codes' | 'encode' | 'done';

interface State {
  stage: Stage;
  text: string;
  cursor: number; // highlighted char in the text (-1 = none)
  freq: { ch: string; n: number }[]; // first-seen order
  hotCh: string | null;
  nodes: HNode[];
  roots: number[]; // priority queue, lightest first
  tones: Record<number, Tone>;
  edgeTones: Record<string, Tone>;
  codes: Record<string, string>;
  enc: string[]; // code emitted for each char encoded so far
}

/** Printable stand-in for characters that would vanish or break the narration markup. */
const disp = (ch: string) => (ch === ' ' ? '␣' : ch === '*' ? '∗' : ch === '`' ? 'ˋ' : ch);
const byKey = (a: HNode, b: HNode) => a.w - b.w || a.id - b.id;

function* run(text: Input): Generator<Frame<State>> {
  const freqMap = new Map<string, number>();
  const base: State = { stage: 'count', text, cursor: -1, freq: [], hotCh: null, nodes: [], roots: [], tones: {}, edgeTones: {}, codes: {}, enc: [] };
  const snap = (p: Partial<State>): State => structuredClone({ ...base, ...p });
  const freqList = () => [...freqMap].map(([ch, n]) => ({ ch, n }));

  yield {
    state: snap({}),
    line: 'fn',
    note: `Compress **"${[...text].map(disp).join('')}"** (${text.length} chars = **${text.length * 8} bits** in plain 8-bit ASCII). Idea: frequent characters should get **short** codes, rare ones long codes.`,
    vars: { i: undefined, ch: undefined, 'freq[ch]': undefined },
    phase: 'count',
  };

  // ---- 1. frequency table ----
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const n = (freqMap.get(ch) ?? 0) + 1;
    freqMap.set(ch, n);
    yield {
      state: snap({ cursor: i, freq: freqList(), hotCh: ch }),
      line: 'count',
      note:
        n === 1
          ? `**'${disp(ch)}'** is new — start its tally at **1**.`
          : `Another **'${disp(ch)}'** — its tally grows to **${n}**.`,
      vars: { i, ch: disp(ch), 'freq[ch]': n },
      phase: 'count',
    };
  }
  const freq = freqList();
  base.stage = 'forest';

  // ---- 2. priority queue of single-leaf trees ----
  const leaves = [...freq].sort((a, b) => a.n - b.n || (a.ch < b.ch ? -1 : a.ch > b.ch ? 1 : 0));
  const nodes: HNode[] = leaves.map((l, id) => ({ id, w: l.n, ch: l.ch }));
  let roots = nodes.map((n) => n.id);
  const W = (id: number) => nodes[id].w;
  const lbl = (id: number) => (nodes[id].ch !== undefined ? `'${disp(nodes[id].ch!)}'` : 'a subtree');
  yield {
    state: snap({ freq, nodes, roots }),
    line: 'queue',
    note: `Every character becomes a one-node tree weighted by its count. The priority queue keeps them **lightest first**; ties go to the smaller character, so the result is deterministic.`,
    vars: { 'pq.length': roots.length, a: undefined, b: undefined, 'a.w + b.w': undefined },
    phase: 'build tree',
  };

  // ---- 3. merge the two lightest until one tree remains ----
  while (roots.length > 1) {
    const [a, b] = roots;
    const qv = { 'pq.length': roots.length, a: W(a), b: W(b) };
    yield {
      state: snap({ freq, nodes, roots, tones: { [a]: 'compare', [b]: 'compare' } }),
      line: ['loop', 'pop'],
      note: `${roots.length} trees left, so keep merging. Pop the two lightest: ${lbl(a)} (**${W(a)}**) and ${lbl(b)} (**${W(b)}**) — rare symbols get buried deepest.`,
      vars: { ...qv, 'a.w + b.w': undefined },
      phase: 'build tree',
    };
    const p: HNode = { id: nodes.length, w: W(a) + W(b), kids: [a, b] };
    nodes.push(p);
    const merged = [p.id, ...roots.slice(2)];
    yield {
      state: snap({ freq, nodes, roots: merged, tones: { [p.id]: 'swap', [a]: 'compare', [b]: 'compare' }, edgeTones: { [`${p.id}-${a}`]: 'swap', [`${p.id}-${b}`]: 'swap' } }),
      line: 'merge',
      note: `Join them under a new parent of weight **${W(a)} + ${W(b)} = ${p.w}**. The left branch will mean bit **0**, the right branch bit **1**.`,
      vars: { ...qv, 'a.w + b.w': p.w },
      phase: 'build tree',
    };
    roots = [...merged].sort((x, y) => byKey(nodes[x], nodes[y]));
    const pos = roots.indexOf(p.id);
    yield {
      state: snap({ freq, nodes, roots, tones: { [p.id]: 'active' } }),
      line: 'push',
      note:
        roots.length === 1
          ? `Push it back — it is the only tree left, so it is the **Huffman tree**.`
          : pos === 0
            ? `Push the new tree back: weight **${p.w}** is still the lightest, so it stays at the front.`
            : `Push the new tree back into the queue: weight **${p.w}** slides to position **${pos + 1}** of ${roots.length}${pos === roots.length - 1 ? ' (the back — ties go behind older trees)' : ''}.`,
      vars: { 'pq.length': roots.length, a: W(a), b: W(b), 'a.w + b.w': p.w },
      phase: 'build tree',
    };
  }
  const root = roots[0];

  // ---- 4. walk the tree to assign codes ----
  const codes: Record<string, string> = {};
  const parentOf = new Map<number, number>();
  nodes.forEach((n) => n.kids?.forEach((k) => parentOf.set(k, n.id)));
  const pathTo = (id: number) => {
    const ids = [id];
    while (parentOf.has(ids[0])) ids.unshift(parentOf.get(ids[0])!);
    return ids;
  };
  const pathTones = (id: number, end: Tone) => {
    const ids = pathTo(id);
    const tones: Record<number, Tone> = {};
    const edgeTones: Record<string, Tone> = {};
    for (const n of nodes) if (n.ch !== undefined && codes[n.ch] !== undefined) tones[n.id] = 'done';
    ids.forEach((x, k) => {
      tones[x] = k === ids.length - 1 ? end : 'path';
      if (k) edgeTones[`${ids[k - 1]}-${x}`] = 'path';
    });
    return { tones, edgeTones };
  };
  const order: { id: number; path: string; via: 'root' | 'left' | 'right' }[] = [];
  const dfs = (id: number, path: string, via: 'root' | 'left' | 'right') => {
    order.push({ id, path, via });
    const k = nodes[id].kids;
    if (k) {
      dfs(k[0], path + '0', 'left');
      dfs(k[1], path + '1', 'right');
    }
  };
  dfs(root, '', 'root');
  for (const { id, path, via } of order) {
    const n = nodes[id];
    const leaf = n.ch !== undefined;
    if (leaf) codes[n.ch!] = path;
    yield {
      state: snap({ stage: 'codes', freq, nodes, roots, codes, ...pathTones(id, leaf ? 'found' : 'active') }),
      line: leaf ? 'leaf' : via === 'root' ? 'walk' : via,
      note: leaf
        ? `Reached leaf **'${disp(n.ch!)}'** (count ${n.w}) — the turns taken spell its code **${path}** (${path.length} bit${path.length > 1 ? 's' : ''}).`
        : via === 'root'
          ? `Now read codes off the tree: start at the root with an empty path. Going left appends **0**, going right appends **1**.`
          : `Step ${via} (append **${via === 'left' ? 0 : 1}**) — path so far **${path}**.`,
      vars: { node: leaf ? `'${disp(n.ch!)}'` : n.w, path: path || '""' },
      phase: 'assign codes',
    };
  }

  // ---- 5. encode ----
  const enc: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    enc.push(codes[ch]);
    const leafId = nodes.find((n) => n.ch === ch)!.id;
    yield {
      state: snap({ stage: 'encode', cursor: i, freq, nodes, roots, codes, enc, ...pathTones(leafId, 'found') }),
      line: 'encode',
      note: `**'${disp(ch)}'** → append **${codes[ch]}**. ${codes[ch].length <= 2 ? 'A frequent character, so only ' + codes[ch].length + ' bit' + (codes[ch].length > 1 ? 's' : '') + '.' : 'Rarer, so a longer code.'} Encoded so far: ${enc.join('').length} bits.`,
      vars: { i, ch: disp(ch), code: codes[ch], 'bits.length': enc.join('').length },
      phase: 'encode',
    };
  }
  const bits = enc.join('').length;
  const allDone: Record<number, Tone> = {};
  for (const n of nodes) if (n.ch !== undefined) allDone[n.id] = 'done';
  yield {
    state: snap({ stage: 'done', freq, nodes, roots, codes, enc, tones: allDone }),
    line: 'done',
    note: `Done: **${text.length * 8} bits → ${bits} bits** (${Math.round((bits / (text.length * 8)) * 100)}% of the original). No code is a prefix of another — every leaf is a dead end — so the bit string decodes unambiguously.`,
    vars: { i: text.length, ch: undefined, code: undefined, 'bits.length': bits },
    phase: 'done',
  };
}

/* ---------------- view pieces ---------------- */

const STYLE = `
.huffman-coding-draw { stroke-dasharray: 1; stroke-dashoffset: 0; animation: huffman-coding-draw calc(var(--step-ms) * 0.9) var(--ease-out) both; }
.huffman-coding-col { animation: huffman-coding-in calc(var(--step-ms) * 0.9) var(--ease-out) both; }
@keyframes huffman-coding-draw { from { stroke-dashoffset: 1; } }
@keyframes huffman-coding-in { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .huffman-coding-draw, .huffman-coding-col { animation: none; } }
`;

/** Deterministic wobble so tally strokes look hand-drawn but don't jitter between frames. */
const wob = (seed: number) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2;
};

function Tally({ freq, hot, cols, maxN }: { freq: State['freq']; hot: string | null; cols: number; maxN: number }) {
  const colW = 58;
  const rowH = 22;
  const rows = Math.max(1, Math.ceil(maxN / 10));
  const W = Math.max(cols, 4) * colW;
  const H = 40 + rows * rowH + 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.25, display: 'block', margin: '0 auto', overflow: 'visible' }} role="img" aria-label="frequency tally">
      <style>{STYLE}</style>
      {freq.map(({ ch, n }, c) => {
        const x0 = c * colW + colW / 2;
        const isHot = ch === hot;
        return (
          <g key={ch} className="huffman-coding-col">
            <rect x={x0 - 15} y={2} width={30} height={30} rx={8} style={{ fill: isHot ? toneFill('active') : 'var(--ink-3)', stroke: 'var(--line-strong)', transition: 'fill var(--step-ms) ease' }} />
            <text x={x0} y={22.5} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={15} style={{ fill: isHot ? toneInk('active') : 'var(--paper)' }}>
              {disp(ch)}
            </text>
            {Array.from({ length: n }, (_, k) => {
              const g = Math.floor(k / 5);
              const j = k % 5;
              const gx = x0 - 23 + (g % 2) * 25;
              const gy = 42 + Math.floor(g / 2) * rowH;
              const seed = c * 97 + k;
              const d =
                j < 4
                  ? `M${gx + 3 + j * 5 + wob(seed)} ${gy + wob(seed + 1)} Q${gx + 3 + j * 5 + wob(seed + 2) * 1.5} ${gy + 8} ${gx + 3 + j * 5 + wob(seed + 3)} ${gy + 16}`
                  : `M${gx - 1} ${gy + 13 + wob(seed)} Q${gx + 10} ${gy + 8 + wob(seed + 1) * 2} ${gx + 22} ${gy + 3 + wob(seed + 2)}`;
              return (
                <path
                  key={k}
                  className="huffman-coding-draw"
                  d={d}
                  pathLength={1}
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  style={{ stroke: isHot && k === n - 1 ? toneFill('active') : j === 4 ? toneFill('compare') : 'var(--paper-dim)' }}
                />
              );
            })}
            <text x={x0} y={H - 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={12} fontWeight={600} style={{ fill: isHot ? toneFill('active') : 'var(--paper-faint)' }}>
              ×{n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CharStrip({ text, tone, codes }: { text: string; tone: (i: number) => Tone | undefined; codes?: (i: number) => string | undefined }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 4px', justifyContent: 'center' }}>
      {[...text].map((ch, i) => {
        const t = tone(i);
        const code = codes?.(i);
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 26 }}>
            <span
              style={{
                width: 26,
                height: 30,
                borderRadius: 7,
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: 15,
                background: t ? toneFill(t) : 'var(--ink-3)',
                color: t ? toneInk(t) : 'var(--paper)',
                border: '1px solid var(--line-strong)',
                transition: 'background-color var(--step-ms) ease, color var(--step-ms) ease',
              }}
            >
              {disp(ch)}
            </span>
            {codes && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: code ? 'var(--paper-dim)' : 'transparent', minHeight: 12 }}>{code ?? '·'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const { stage, text, cursor } = s;
  const finalFreq = new Map<string, number>();
  for (const ch of text) finalFreq.set(ch, (finalFreq.get(ch) ?? 0) + 1);
  const maxN = Math.max(...finalFreq.values());

  const tree: TreeNode[] = s.nodes.map((n) => {
    const leaf = n.ch !== undefined;
    const code = leaf ? s.codes[n.ch!] : undefined;
    return {
      id: n.id,
      label: leaf ? disp(n.ch!) : n.w,
      sub: leaf ? (code !== undefined ? code : `×${n.w}`) : undefined,
      shape: leaf ? 'pill' : 'circle',
      tone: s.tones[n.id],
      children: n.kids,
    };
  });
  const edgeLabels: Record<string, string> = {};
  for (const n of s.nodes) if (n.kids) n.kids.forEach((k, j) => (edgeLabels[`${n.id}-${k}`] = String(j)));

  const textTone = (i: number): Tone | undefined => {
    if (stage === 'count') return i === cursor ? 'active' : i < cursor ? 'visited' : undefined;
    if (stage === 'encode') return i === cursor ? 'found' : i < cursor ? 'done' : undefined;
    if (stage === 'done') return 'done';
    return undefined;
  };
  const showCodes = stage === 'encode' || stage === 'done';
  const bits = s.enc.join('').length;
  const orig = text.length * 8;

  return (
    <VizStack gap={20}>
      <VizSection label="text" aside={showCodes ? `${bits} bits emitted` : `${text.length} chars · ${finalFreq.size} distinct`}>
        <CharStrip text={text} tone={textTone} codes={showCodes ? (i) => (i < s.enc.length ? s.enc[i] : undefined) : undefined} />
      </VizSection>

      {s.nodes.length === 0 ? (
        <VizSection label="frequency tally" aside="count every character">
          <Tally freq={s.freq} hot={s.hotCh} cols={finalFreq.size} maxN={maxN} />
        </VizSection>
      ) : (
        <VizSection
          label={stage === 'forest' || stage === 'count' ? `priority queue · ${s.roots.length} tree${s.roots.length > 1 ? 's' : ''}, lightest first →` : 'huffman tree'}
          aside={stage === 'forest' || stage === 'count' ? 'number = weight (total count)' : 'left = 0 · right = 1'}
        >
          <TreeView nodes={tree} roots={s.roots} edgeLabels={edgeLabels} edgeTones={s.edgeTones} nodeSize={36} levelGap={62} siblingGap={12} minHeight={130} />
        </VizSection>
      )}

      {(stage === 'codes' || showCodes) && (
        <TokenStrip
          label="codes"
          items={[...s.freq]
            .filter((f) => s.codes[f.ch] !== undefined)
            .sort((a, b) => b.n - a.n || s.codes[a.ch].length - s.codes[b.ch].length)
            .map((f) => ({ id: f.ch, text: `${disp(f.ch)} = ${s.codes[f.ch]}`, tone: stage === 'encode' && text[cursor] === f.ch ? 'found' : 'done' }))}
          empty="walking the tree…"
        />
      )}

      {showCodes && (
        <TokenStrip
          label="bits"
          items={s.enc.map((c, i) => ({ id: i, text: c, tone: stage === 'encode' && i === s.enc.length - 1 ? 'found' : i % 2 ? 'frontier' : 'visited' }))}
        />
      )}

      {showCodes && (
        <StatRow
          stats={[
            { label: 'plain ASCII (8 × n)', value: stage === 'done' ? orig : Math.min(orig, (cursor + 1) * 8) },
            { label: 'huffman bits', value: bits, tone: 'found' },
            { label: 'size vs. ASCII', value: `${Math.round((bits / Math.max(1, stage === 'done' ? orig : (cursor + 1) * 8)) * 100)}%` },
            { label: 'avg bits / char', value: (bits / Math.max(1, s.enc.length)).toFixed(2) },
          ]}
        />
      )}
      {stage === 'done' && (
        <Callout show tone="found">
          {orig} bits → {bits} bits
        </Callout>
      )}
    </VizStack>
  );
}

function Glyph() {
  const dur = '4s';
  return (
    <svg viewBox="0 0 120 80">
      {/* edges draw in, then the parent pops */}
      <path d="M60 18 L34 44 M60 18 L86 44 M34 44 L20 66 M34 44 L48 66" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeOpacity={0.7} pathLength={1} strokeDasharray="1">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0" keyTimes="0;0.2;0.55;1" dur={dur} repeatCount="indefinite" />
      </path>
      {[
        [20, 66, '#6cb6ff'],
        [48, 66, '#6cb6ff'],
        [86, 44, '#a98bff'],
      ].map(([x, y, c], k) => (
        <rect key={k} x={(x as number) - 7} y={(y as number) - 7} width={14} height={14} rx={4} fill={c as string} />
      ))}
      <circle cx={34} cy={44} r={7} fill="currentColor">
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.3;0.4;1" dur={dur} repeatCount="indefinite" />
      </circle>
      <circle cx={60} cy={18} r={8} fill="#ffd166">
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.5;0.6;1" dur={dur} repeatCount="indefinite" />
      </circle>
      <text x={42} y={32} fontSize={9} fontFamily="monospace" fill="currentColor">0</text>
      <text x={74} y={32} fontSize={9} fontFamily="monospace" fill="currentColor">1</text>
      <g fontFamily="monospace" fontSize={9} fill="#c6f36b">
        <text x={96} y={70}>
          0110
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.65;0.75;0.95;1" dur={dur} repeatCount="indefinite" />
        </text>
      </g>
    </svg>
  );
}

const WORDS = ['banana bandana', 'abracadabra', 'she sells sea shells', 'go go gophers', 'peter piper picked', 'aaaabbbccd', 'hello world', 'bookkeeper', 'committee meeting', 'mississippi'];

export default defineAlgorithm<Input, State>({
  id: 'huffman-coding',
  name: 'Huffman Coding',
  category: 'basic',
  order: 1,
  tagline: 'Give frequent characters short codes by repeatedly merging the two rarest.',
  description:
    'A lossless compression scheme. Count how often each character appears, then build a binary tree **bottom-up** by always merging the two lightest trees. Each character’s code is its path from the root (`0` = left, `1` = right), so common characters sit near the top with **short** codes and no code is a prefix of another.',
  howItWorks: [
    'Count the frequency of every character.',
    'Put each character in a priority queue as a one-node tree weighted by its count.',
    'Pop the two lightest trees, hang them under a new parent whose weight is their sum, push it back.',
    'When one tree remains, read each code off the root→leaf path (left = 0, right = 1).',
    'Replace every character with its code to get the compressed bit string.',
  ],
  complexity: { time: 'O(n + k log k)', space: 'O(k)', note: 'n = text length, k = distinct characters. Huffman codes are optimal among prefix codes that encode one symbol at a time.' },
  code: {
    js: `
function huffman(text) { //@fn
  const freq = new Map();
  for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1); //@count
  const pq = [...freq].map(([ch, w]) => ({ ch, w })) //@queue
    .sort((a, b) => a.w - b.w || (a.ch < b.ch ? -1 : 1));
  while (pq.length > 1) { //@loop
    const a = pq.shift(), b = pq.shift(); //@pop
    const node = { w: a.w + b.w, left: a, right: b }; //@merge
    let i = 0; while (i < pq.length && pq[i].w <= node.w) i++;
    pq.splice(i, 0, node); //@push
  }
  const codes = {};
  const walk = (n, path) => { //@walk
    if (n.ch !== undefined) { codes[n.ch] = path; return; } //@leaf
    walk(n.left, path + '0'); //@left
    walk(n.right, path + '1'); //@right
  };
  walk(pq[0], '');
  let bits = '';
  for (const ch of text) bits += codes[ch]; //@encode
  return { codes, bits }; //@done
}`,
    py: `
import heapq
from itertools import count

def huffman(text): #@fn
    freq = {}
    for ch in text:
        freq[ch] = freq.get(ch, 0) + 1 #@count
    tick = count()  # tie-breaker: older trees first
    items = sorted(freq.items(), key=lambda kv: (kv[1], kv[0]))
    pq = [(w, next(tick), ch) for ch, w in items] #@queue
    while len(pq) > 1: #@loop
        wa, _, a = heapq.heappop(pq) #@pop
        wb, _, b = heapq.heappop(pq) #@pop
        node = (a, b) #@merge
        heapq.heappush(pq, (wa + wb, next(tick), node)) #@push
    codes = {}
    def walk(n, path): #@walk
        if isinstance(n, str): #@leaf
            codes[n] = path
            return
        walk(n[0], path + '0') #@left
        walk(n[1], path + '1') #@right
    walk(pq[0][2], '')
    bits = ''.join(codes[ch] for ch in text) #@encode
    return codes, bits #@done`,
  },
  input: {
    default: 'mississippi river',
    presets: [
      { name: 'abracadabra', value: 'abracadabra' },
      { name: 'Skewed (aaaaaaab)', value: 'aaaaaaab' },
      { name: 'All different', value: 'abcdefgh' },
      { name: 'Fibonacci counts (deep tree)', value: 'abbcccddddd eeeeeeee' },
    ],
    random: () => {
      if (Math.random() < 0.5) return WORDS[randInt(0, WORDS.length - 1)];
      const alphabet = shuffle('abcdefghijklmnop'.split('')).slice(0, randInt(2, 7));
      const len = randInt(8, 24);
      const weights = alphabet.map(() => randInt(1, 6));
      const total = weights.reduce((a, b) => a + b, 0);
      let out = alphabet.join('').slice(0, 2);
      while (out.length < len) {
        let r = randInt(1, total);
        let k = 0;
        while (r > weights[k]) r -= weights[k++];
        out += alphabet[k];
      }
      return shuffle(out.split('')).join('');
    },
    format: (v) => v,
    parse: (raw) => {
      const text = raw.trim();
      if (/[\n\r\t]/.test(text)) throw new Error('Keep it to a single line (no tabs or line breaks).');
      if (text.length < 2) throw new Error('Type at least 2 characters.');
      if (text.length > 40) throw new Error(`That's ${text.length} characters — 40 or fewer keep the tree readable.`);
      const distinct = new Set(text).size;
      if (distinct < 2)
        throw new Error(`Only one distinct character ('${text[0]}') — Huffman needs at least 2 symbols to build a tree (a lone symbol would just be coded as "0").`);
      if (distinct > 16) throw new Error(`${distinct} distinct characters — keep it to 16 so the tree fits.`);
      return text;
    },
    placeholder: 'mississippi river',
    hint: 'Any text, 2–40 characters, at least 2 (and at most 16) different characters. Spaces count and show as ␣.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'current character / tree' },
    { tone: 'compare', label: 'two lightest (popped)' },
    { tone: 'swap', label: 'new parent' },
    { tone: 'path', label: 'root → leaf path' },
    { tone: 'found', label: 'leaf reached / emitting' },
    { tone: 'done', label: 'code assigned' },
  ],
  Glyph,
});
