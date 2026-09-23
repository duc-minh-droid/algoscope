import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { randInt } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizSection, VizStack, toneFill, toneInk, type Pointer, type Span } from '@/viz';

interface Input {
  text: string;
  pattern: string;
}

type Range = [number, number] | null;

interface State {
  stage: 'lps' | 'search' | 'done';
  text: string;
  pat: string;
  lps: (number | null)[];
  // build-LPS stage
  li: number; // i while building
  len: number;
  lcmp: 'eq' | 'ne' | null;
  wrote: number; // lps index just written (-1)
  fellFrom: number | null; // len before falling back
  pre: Range;
  suf: Range;
  // search stage
  i: number;
  j: number;
  cmp: 'eq' | 'ne' | null;
  skip: { from: number; to: number; k: number; via: number } | null; // shift from → to, k chars known, via lps index
  matches: number[];
  flash: number; // just-found match start (-1)
  comps: number;
}

function* run({ text, pattern: pat }: Input): Generator<Frame<State>> {
  const m = pat.length;
  const lps: (number | null)[] = Array(m).fill(null);
  lps[0] = 0;
  let li = 1;
  let len = 0;
  const base = (): State => ({
    stage: 'lps',
    text,
    pat,
    lps: [...lps],
    li,
    len,
    lcmp: null,
    wrote: -1,
    fellFrom: null,
    pre: len > 0 ? [0, len - 1] : null,
    suf: len > 0 ? [li - len, li - 1] : null,
    i: -1,
    j: -1,
    cmp: null,
    skip: null,
    matches: [],
    flash: -1,
    comps: 0,
  });
  const lv = () => ({ i: li, len, lps: lps.map((v) => (v === null ? '·' : v)) as (string | number)[], j: undefined, matches: [] as number[] });
  const q = (s: string) => `"${s}"`;

  yield {
    state: { ...base(), li: -1 },
    line: 'lpsFn',
    note: `Before touching the text, KMP studies the pattern **${q(pat)}** on its own. For each position it records \`lps\`: the length of the longest proper **prefix** that is also a **suffix** of the pattern up to there.`,
    vars: lv(),
    phase: 'build LPS',
  };
  yield {
    state: base(),
    line: 'lpsInit',
    note: `\`lps[0] = 0\` always (a single char has no proper prefix). \`len\` = length of the prefix currently matched, \`i\` walks the pattern from 1.`,
    vars: lv(),
    phase: 'build LPS',
  };

  while (li < m) {
    const eq = pat[li] === pat[len];
    yield {
      state: { ...base(), lcmp: eq ? 'eq' : 'ne' },
      line: ['lpsLoop', 'lpsCmp'],
      note:
        len === 0
          ? `Compare \`p[${li}] = '${pat[li]}'\` with the very first char \`p[0] = '${pat[0]}'\`: ${eq ? 'same — a 1-char prefix repeats here.' : 'different.'}`
          : `We know ${q(pat.slice(0, len))} (prefix) = ${q(pat.slice(li - len, li))} (suffix). Can it grow? Compare \`p[${li}] = '${pat[li]}'\` with \`p[${len}] = '${pat[len]}'\` — ${eq ? 'yes, equal!' : 'no.'}`,
      vars: lv(),
      phase: 'build LPS',
    };
    if (eq) {
      len++;
      lps[li] = len;
      const w = li;
      li++;
      yield {
        state: { ...base(), wrote: w, pre: [0, len - 1], suf: [w - len + 1, w] },
        line: 'lpsMatch',
        note: `Match → prefix ${q(pat.slice(0, len))} is also the suffix ending at ${w}, so **lps[${w}] = ${len}**. Move both \`i\` and \`len\` forward.`,
        vars: lv(),
        phase: 'build LPS',
      };
    } else if (len > 0) {
      const from = len;
      len = lps[len - 1] as number;
      yield {
        state: { ...base(), fellFrom: from },
        line: 'lpsFall',
        note: `Mismatch, but we don't restart from 0: the next-best candidate is the border of ${q(pat.slice(0, from))}, i.e. \`len = lps[${from - 1}] = ${len}\`. Retry the same \`i\` with this shorter prefix.`,
        vars: lv(),
        phase: 'build LPS',
      };
    } else {
      lps[li] = 0;
      const w = li;
      li++;
      yield {
        state: { ...base(), wrote: w, pre: null, suf: null },
        line: 'lpsZero',
        note: `Mismatch with \`len = 0\` — no prefix of the pattern ends at ${w}, so **lps[${w}] = 0**. Move on.`,
        vars: lv(),
        phase: 'build LPS',
      };
    }
  }

  // ---------- search ----------
  const L = lps as number[];
  let i = 0;
  let j = 0;
  let comps = 0;
  let matches: number[] = [];
  const st = (extra: Partial<State> = {}): State => ({
    ...base(),
    stage: 'search',
    lps: [...L],
    li: -1,
    pre: null,
    suf: null,
    i,
    j,
    matches: [...matches],
    comps,
    ...extra,
  });
  const sv = () => ({ i, len: undefined, lps: [...L], j, matches: [...matches] });

  yield {
    state: st({ i: -1, j: -1 }),
    line: 'build',
    note: `LPS table ready: **[${L.join(', ')}]**. It tells us, after a mismatch, how much of the pattern is **still** matched — so the text pointer never moves backwards.`,
    vars: { ...sv(), i: undefined, j: undefined },
    phase: 'search',
  };
  yield {
    state: st(),
    line: 'init',
    note: `Align the pattern under the start of the text: \`i = 0\` (text), \`j = 0\` (pattern).`,
    vars: sv(),
    phase: 'search',
  };

  while (i < text.length) {
    const eq = text[i] === pat[j];
    comps++;
    yield {
      state: st({ cmp: eq ? 'eq' : 'ne' }),
      line: ['loop', 'cmp'],
      note: `Compare \`text[${i}] = '${text[i]}'\` with \`pat[${j}] = '${pat[j]}'\`: ${eq ? '**match**.' : '**mismatch**.'}`,
      vars: sv(),
      phase: 'search',
    };
    if (eq) {
      i++;
      j++;
      if (j === m) {
        const at = i - j;
        matches = [...matches, at];
        yield {
          state: st({ flash: at }),
          line: ['adv', 'full'],
          note: `All **${m}** chars line up — the pattern occurs at index **${at}**! Record it.`,
          vars: sv(),
          phase: 'search',
        };
        const k = L[j - 1];
        const from = i - j;
        j = k;
        yield {
          state: st({ skip: { from, to: i - j, k, via: m - 1 } }),
          line: 'hit',
          note:
            k > 0
              ? `To find overlapping matches, slide using \`lps[${m - 1}] = ${k}\`: the last ${k} char${k > 1 ? 's' : ''} we just matched (${q(pat.slice(0, k))}) already equal the pattern's start — **skip ahead** without re-reading them.`
              : `\`lps[${m - 1}] = 0\`: no part of the match can start a new one, so the pattern slides fully past it.`,
          vars: sv(),
          phase: 'search',
        };
      } else {
        yield {
          state: st(),
          line: 'adv',
          note: `Advance both: \`i = ${i}\`, \`j = ${j}\`. ${j} char${j > 1 ? 's' : ''} of the pattern matched so far.`,
          vars: sv(),
          phase: 'search',
        };
      }
    } else if (j > 0) {
      const from = i - j;
      const old = j;
      j = L[j - 1];
      yield {
        state: st({ skip: { from, to: i - j, k: j, via: old - 1 } }),
        line: 'skip',
        note:
          j > 0
            ? `Don't back up \`i\`! \`lps[${old - 1}] = ${j}\` says the matched ${q(pat.slice(0, old))} ends with ${q(pat.slice(0, j))} — **skip ahead**: the first ${j} char${j > 1 ? 's' : ''} already match, so slide the pattern by ${old - j} and set \`j = ${j}\`.`
            : `\`lps[${old - 1}] = 0\`: nothing from ${q(pat.slice(0, old))} can be reused — slide the pattern by ${old} so it starts at \`i\`, \`j = 0\`. \`i\` still doesn't move back.`,
        vars: sv(),
        phase: 'search',
      };
    } else {
      i++;
      yield {
        state: st({ skip: i < text.length ? { from: i - 1, to: i, k: 0, via: -1 } : null }),
        line: 'next',
        note: `Mismatch on the pattern's first char — nothing to reuse. Just move the text pointer: \`i = ${i}\`.`,
        vars: sv(),
        phase: 'search',
      };
    }
  }

  yield {
    state: st({ stage: 'done', i: text.length, j: -1 }),
    line: 'ret',
    note: matches.length
      ? `Scan complete after **${comps}** comparisons (text length ${text.length}). Found ${matches.length} match${matches.length > 1 ? 'es' : ''} at **[${matches.join(', ')}]**.`
      : `Scan complete after **${comps}** comparisons — ${q(pat)} does **not** occur in the text.`,
    vars: sv(),
    phase: 'done',
  };
}

/* ---------------- view ---------------- */

const STYLE = `
.kmp-slide { transition: transform var(--step-ms) var(--ease-in-out); }
.kmp-fill { transition: fill var(--step-ms) ease, stroke var(--step-ms) ease, opacity var(--step-ms) ease; }
.kmp-draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: kmp-draw calc(var(--step-ms) * 1.2) var(--ease-out) forwards; }
@keyframes kmp-draw { to { stroke-dashoffset: 0; } }
.kmp-pop { animation: kmp-pop calc(var(--step-ms) * 1.3) var(--ease-out); }
@keyframes kmp-pop { from { opacity: 0; transform: translateY(5px); } }
@media (prefers-reduced-motion: reduce) {
  .kmp-slide { transition: none; }
  .kmp-draw { animation: none; stroke-dashoffset: 0; }
  .kmp-pop { animation: none; }
}`;

function allMatches(text: string, pat: string) {
  const res: number[] = [];
  for (let s = 0; s + pat.length <= text.length; s++) if (text.startsWith(pat, s)) res.push(s);
  return res;
}

/** Greedy level assignment so overlapping match brackets stack. */
function levels(ms: number[], m: number) {
  const ends: number[] = [];
  return ms.map((s) => {
    let l = ends.findIndex((e) => e < s);
    if (l < 0) l = ends.length;
    ends[l] = s + m - 1;
    return l;
  });
}

function SearchStrip({ s }: { s: State }) {
  const { text, pat } = s;
  const n = text.length;
  const m = pat.length;
  const C = 32;
  const G = 5;
  const ST = C + G;
  const pad = 16;
  const every = allMatches(text, pat);
  const lvAll = levels(every, m);
  const depth = Math.max(1, ...lvAll.map((l) => l + 1));
  const topH = depth * 20 + 8;
  const yIdx = topH + 10;
  const yText = yIdx + 8;
  const yPat = yText + C + 38;
  const H = yPat + C + 66;
  const W = pad * 2 + n * ST - G;
  const xOf = (k: number) => pad + k * ST;
  const shift = s.i >= 0 && s.j >= 0 ? s.i - s.j : 0;
  const searching = s.stage === 'search' && s.i >= 0 && s.j >= 0;
  const cmpTone: Tone = s.cmp === 'eq' ? 'done' : s.cmp === 'ne' ? 'compare' : 'active';
  const flashTo = s.flash >= 0 ? s.flash + m - 1 : -1;
  const known = s.skip ? s.skip.k : 0;

  const textTone = (k: number): Tone => {
    if (s.flash >= 0 && k >= s.flash && k <= flashTo) return 'found';
    if (!searching) return s.stage === 'done' && s.matches.some((a) => k >= a && k < a + m) ? 'found' : 'idle';
    if (k === s.i && s.i < n) return cmpTone;
    if (known > 0 && k >= s.i - known && k < s.i) return 'frontier';
    if (k >= shift && k < s.i) return 'done';
    if (k < s.i) return 'muted';
    return 'idle';
  };
  const patTone = (q: number): Tone => {
    if (s.stage === 'done') return 'muted';
    if (s.flash >= 0) return 'found';
    if (!searching) return 'idle';
    if (q < known) return 'frontier';
    if (q < s.j) return 'done';
    if (q === s.j && s.i < n) return cmpTone;
    return 'idle';
  };

  const cell = (x: number, y: number, ch: string, t: Tone, key: string) => (
    <g key={key} transform={`translate(${x} ${y})`} opacity={t === 'muted' ? 0.4 : 1} className="kmp-fill">
      <rect className="kmp-fill" width={C} height={C} rx={8} fill={t === 'idle' || t === 'muted' ? 'var(--ink-3)' : toneFill(t)} stroke={t === 'idle' ? 'var(--line-strong)' : 'transparent'} />
      <text x={C / 2} y={C / 2 + 6} textAnchor="middle" fontSize={17} fontWeight={700} fontFamily="var(--font-mono)" fill={t === 'idle' || t === 'muted' ? 'var(--paper)' : toneInk(t)}>
        {ch}
      </text>
    </g>
  );

  const sk = s.skip;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W * 1.5, display: 'block', margin: '0 auto', overflow: 'visible' }} role="img" aria-label="text and sliding pattern">
      <style>{STYLE}</style>
      {/* match brackets */}
      {s.matches.map((a) => {
        const l = lvAll[every.indexOf(a)] ?? 0;
        const y = topH - l * 20;
        const x0 = xOf(a) + 2;
        const x1 = xOf(a + m - 1) + C - 2;
        return (
          <g key={a} className="kmp-pop">
            <path d={`M${x0} ${y} v-6 H${x1} v6`} fill="none" stroke={toneFill('found')} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <text x={(x0 + x1) / 2} y={y - 9} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="var(--font-mono)" fill={toneFill('found')}>
              @{a}
            </text>
          </g>
        );
      })}
      {/* indices */}
      {Array.from({ length: n }, (_, k) => (
        <text key={`ix${k}`} x={xOf(k) + C / 2} y={yIdx} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill={searching && k === s.i ? 'var(--amber)' : 'var(--paper-faint)'} fontWeight={searching && k === s.i ? 700 : 400}>
          {k}
        </text>
      ))}
      <text x={pad - 6} y={yText + C / 2 + 4} textAnchor="end" fontSize={10} fontFamily="var(--font-mono)" fill="var(--paper-faint)">
        text
      </text>
      {Array.from(text, (ch, k) => cell(xOf(k), yText, ch, textTone(k), `t${k}`))}
      {/* compare connector */}
      {searching && s.i < n && (
        <g className="kmp-slide" style={{ transform: `translateX(${xOf(s.i) + C / 2}px)` }}>
          <line x1={0} x2={0} y1={yText + C + 4} y2={yPat - 4} stroke={toneFill(cmpTone)} strokeWidth={2} strokeDasharray="3 4" />
          <text x={8} y={(yText + C + yPat) / 2 + 4} fontSize={11} fontWeight={700} fontFamily="var(--font-mono)" fill={toneFill(cmpTone)}>
            {s.cmp === 'eq' ? '=' : s.cmp === 'ne' ? '≠' : '?'}
          </text>
        </g>
      )}
      {/* sliding pattern */}
      <g className="kmp-slide" style={{ transform: `translateX(${shift * ST}px)` }}>
        {Array.from(pat, (ch, q) => cell(xOf(q), yPat, ch, patTone(q), `p${q}`))}
        {Array.from(pat, (_, q) => (
          <text key={`pj${q}`} x={xOf(q) + C / 2} y={yPat + C + 13} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill={searching && q === s.j ? 'var(--amber)' : 'var(--paper-faint)'}>
            {q}
          </text>
        ))}
        {known > 0 && (
          <g className="kmp-pop">
            <path d={`M${xOf(0) + 2} ${yPat - 6} v-5 H${xOf(known - 1) + C - 2} v5`} fill="none" stroke={toneFill('frontier')} strokeWidth={2} strokeLinecap="round" />
          </g>
        )}
      </g>
      {/* slide arrow */}
      {sk && sk.to > sk.from && (
        <g key={`${sk.from}-${sk.to}-${s.i}-${s.matches.length}`}>
          <path
            className="kmp-draw"
            pathLength={1}
            d={`M${xOf(sk.from) + 6} ${yPat + C + 22} Q${(xOf(sk.from) + xOf(sk.to)) / 2 + 6} ${yPat + C + 50} ${xOf(sk.to) + 6} ${yPat + C + 22}`}
            fill="none"
            stroke={toneFill('path')}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <path d={`M${xOf(sk.to) + 6} ${yPat + C + 20} l-7 4 l8 3 z`} fill={toneFill('path')} className="kmp-pop" />
          <text className="kmp-pop" x={(xOf(sk.from) + xOf(sk.to)) / 2 + 6} y={yPat + C + 58} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="var(--font-mono)" fill={toneFill('path')}>
            slide +{sk.to - sk.from}
            {sk.via >= 0 ? ` (lps[${sk.via}] = ${sk.k})` : ''}
          </text>
        </g>
      )}
    </svg>
  );
}

function View({ frame }: { frame: Frame<State> }) {
  const s = frame.state;
  const { pat } = s;
  const m = pat.length;

  if (s.stage === 'lps') {
    const ptrs: Pointer[] = [];
    if (s.li >= 0) ptrs.push({ index: s.li < m ? s.li : -1, label: 'i', tone: 'active' });
    if (s.li >= 0) ptrs.push({ index: s.li < m ? s.len : -1, label: 'len', tone: 'frontier', side: 'bottom' });
    const spans: Span[] = [];
    if (s.pre) spans.push({ from: s.pre[0], to: s.pre[1], label: 'prefix', tone: 'frontier', side: 'top' });
    if (s.suf) spans.push({ from: s.suf[0], to: s.suf[1], label: 'suffix', tone: 'visited' });
    const cmpT: Tone = s.lcmp === 'eq' ? 'done' : 'compare';
    const tone = (k: number): Tone | undefined => {
      if (s.lcmp && (k === s.li || k === s.len)) return cmpT;
      if (k === s.wrote) return 'swap';
      if (s.pre && k >= s.pre[0] && k <= s.pre[1]) return 'frontier';
      if (s.suf && k >= s.suf[0] && k <= s.suf[1]) return 'visited';
      if (k === s.li) return 'active';
      return undefined;
    };
    const lpsTone = (k: number): Tone | undefined =>
      k === s.wrote ? 'swap' : s.fellFrom !== null && k === s.fellFrom - 1 ? 'path' : s.lps[k] === null ? 'muted' : undefined;
    const done = s.lps.filter((v) => v !== null).length;
    return (
      <VizStack gap={18}>
        <StatRow
          stats={[
            { label: 'i', value: s.li >= 0 ? s.li : '—', tone: 'active' },
            { label: 'len (matched prefix)', value: s.len, tone: 'frontier' },
            { label: 'lps filled', value: `${done}/${m}` },
          ]}
        />
        <VizSection label="pattern" aside="longest prefix that is also a suffix">
          <ArrayView items={pat.split('')} tones={tone} pointers={ptrs} spans={spans} cell={m > 12 ? 40 : 50} />
        </VizSection>
        <VizSection label="lps table" aside={s.fellFrom !== null ? `fall back: len = lps[${s.fellFrom - 1}]` : undefined}>
          <ArrayView items={s.lps.map((v) => (v === null ? '·' : v))} tones={lpsTone} caption={(k) => pat[k] ?? ''} cell={m > 12 ? 40 : 50} />
        </VizSection>
      </VizStack>
    );
  }

  const L = s.lps as number[];
  const via = s.skip?.via ?? -1;
  return (
    <VizStack gap={18}>
      <StatRow
        stats={[
          { label: 'i (text)', value: s.stage === 'done' ? '—' : Math.max(0, s.i), tone: 'active' },
          { label: 'j (pattern)', value: s.stage === 'done' || s.j < 0 ? '—' : s.j, tone: 'active' },
          { label: 'comparisons', value: s.comps },
          { label: 'matches', value: s.matches.length, tone: 'found' },
        ]}
      />
      <SearchStrip s={s} />
      <VizSection label="lps table" aside="used on every mismatch">
        <ArrayView
          items={L}
          tones={(k) => (k === via ? 'path' : undefined)}
          caption={(k) => `${pat[k]}·${k}`}
          cell={m > 12 ? 30 : 36}
        />
      </VizSection>
      <Callout show={s.stage === 'done'} tone={s.matches.length ? 'found' : 'danger'}>
        {s.matches.length ? `found at [${s.matches.join(', ')}]` : 'no match'}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  const t = 'ABABCAB';
  return (
    <svg viewBox="0 0 120 80">
      {Array.from(t, (ch, k) => (
        <g key={k}>
          <rect x={6 + k * 16} y={18} width={13} height={15} rx={3} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeOpacity={0.5} />
          <text x={12.5 + k * 16} y={29.5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="monospace" fill="currentColor">
            {ch}
          </text>
        </g>
      ))}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;32 0;32 0;0 0" keyTimes="0;0.35;0.5;0.9;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.7 0 0.2 1;0 0 1 1;0.7 0 0.2 1" />
        {Array.from('ABC', (ch, k) => (
          <g key={k}>
            <rect x={6 + k * 16} y={44} width={13} height={15} rx={3} fill="currentColor">
              <animate attributeName="fill" values="#5fd3a5;#5fd3a5;#ff6b5b;#c6f36b;#c6f36b" keyTimes="0;0.2;0.35;0.6;1" dur="4s" repeatCount="indefinite" calcMode="discrete" />
            </rect>
            <text x={12.5 + k * 16} y={55.5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="monospace" fill="#0b0f18">
              {ch}
            </text>
          </g>
        ))}
      </g>
      <path d="M12 66 Q28 76 44 66" fill="none" stroke="#ffd166" strokeWidth={1.6} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1">
        <animate attributeName="stroke-dashoffset" values="1;1;0;0;1" keyTimes="0;0.35;0.5;0.9;1" dur="4s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

const CHARS = /^[A-Za-z0-9]+$/;

function parse(text: string): Input {
  const bar = text.indexOf('|');
  if (bar < 0) throw new Error('Separate text and pattern with "|", e.g. "ABABDABACD | ABAC".');
  const t = text.slice(0, bar).trim();
  const p = text.slice(bar + 1).trim();
  if (!t) throw new Error('The text (before "|") is empty.');
  if (!p) throw new Error('The pattern (after "|") is empty.');
  if (!CHARS.test(t) || !CHARS.test(p)) throw new Error('Use letters and digits only (no spaces or symbols).');
  if (t.length > 32) throw new Error(`Text is ${t.length} chars — keep it to 32 so every cell fits on screen.`);
  if (p.length > t.length) throw new Error('The pattern must not be longer than the text.');
  return { text: t, pattern: p };
}

function randomInput(): Input {
  const alpha = Math.random() < 0.5 ? 'AB' : 'ABC';
  const r = (len: number) => Array.from({ length: len }, () => alpha[randInt(0, alpha.length - 1)]).join('');
  const pattern = r(randInt(2, 5));
  let text = r(randInt(10, 20));
  if (Math.random() < 0.8) {
    const at = randInt(0, text.length - pattern.length);
    text = text.slice(0, at) + pattern + text.slice(at + pattern.length);
  }
  return { text: text.slice(0, 32), pattern };
}

export default defineAlgorithm<Input, State>({
  id: 'kmp',
  name: 'KMP String Search',
  category: 'arrays',
  order: 3,
  tagline: 'Knuth–Morris–Pratt: never re-read a text character — precompute where to resume.',
  description:
    'Naive search slides the pattern one step and starts comparing all over again. **KMP** first builds an `lps` table (longest **prefix** that is also a **suffix**) for the pattern. On a mismatch after matching `j` chars, it already knows the first `lps[j-1]` chars still match — so it slides the pattern ahead and continues, while the text pointer `i` **never moves backwards**.',
  howItWorks: [
    'Build `lps`: for each pattern position, the length of the longest proper prefix that is also a suffix ending there.',
    'Scan the text with `i` and the pattern with `j`; on a match, advance both.',
    'On a mismatch with `j > 0`, set `j = lps[j-1]` — slide the pattern, keep `i` where it is.',
    'On a full match, record `i - m`, then continue with `j = lps[m-1]` to catch overlapping matches.',
  ],
  complexity: { time: 'O(n + m)', space: 'O(m)', note: 'Each text char is matched once; every fallback is paid for by an earlier advance, so total work is linear.' },
  code: {
    js: `
function buildLPS(p) { //@lpsFn
  const lps = Array(p.length).fill(0); //@lpsInit
  let len = 0, i = 1;
  while (i < p.length) { //@lpsLoop
    if (p[i] === p[len]) { //@lpsCmp
      lps[i++] = ++len; //@lpsMatch
    } else if (len > 0) {
      len = lps[len - 1]; //@lpsFall
    } else {
      lps[i++] = 0; //@lpsZero
    }
  }
  return lps;
}
function kmp(text, p) { //@fn
  const lps = buildLPS(p), res = []; //@build
  let i = 0, j = 0; //@init
  while (i < text.length) { //@loop
    if (text[i] === p[j]) { //@cmp
      i++; j++; //@adv
      if (j === p.length) { //@full
        res.push(i - j); j = lps[j - 1]; //@hit
      }
    } else if (j > 0) {
      j = lps[j - 1]; //@skip
    } else {
      i++; //@next
    }
  }
  return res; //@ret
}`,
    py: `
def build_lps(p): #@lpsFn
    lps, length, i = [0] * len(p), 0, 1 #@lpsInit
    while i < len(p): #@lpsLoop
        if p[i] == p[length]: #@lpsCmp
            length += 1; lps[i] = length; i += 1 #@lpsMatch
        elif length > 0:
            length = lps[length - 1] #@lpsFall
        else:
            lps[i] = 0; i += 1 #@lpsZero
    return lps

def kmp(text, p): #@fn
    lps, res = build_lps(p), [] #@build
    i = j = 0 #@init
    while i < len(text): #@loop
        if text[i] == p[j]: #@cmp
            i += 1; j += 1 #@adv
            if j == len(p): #@full
                res.append(i - j); j = lps[j - 1] #@hit
        elif j > 0:
            j = lps[j - 1] #@skip
        else:
            i += 1 #@next
    return res #@ret`,
  },
  input: {
    default: { text: 'ABABDABACDABABCABAB', pattern: 'ABABCABAB' },
    presets: [
      { name: 'Classic', value: { text: 'ABABDABACDABABCABAB', pattern: 'ABABCABAB' } },
      { name: 'Overlapping matches', value: { text: 'AAAAABAAAA', pattern: 'AAA' } },
      { name: 'No match', value: { text: 'ABCABDABCABE', pattern: 'ABCABC' } },
      { name: 'Pattern = text', value: { text: 'ABCAB', pattern: 'ABCAB' } },
    ],
    random: randomInput,
    format: (v) => `${v.text} | ${v.pattern}`,
    parse,
    placeholder: 'ABABDABACDABABCABAB | ABABCABAB',
    hint: 'Text, then "|" and the pattern. Letters/digits only, text ≤ 32 chars, pattern no longer than the text.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'about to compare' },
    { tone: 'done', label: 'matched so far' },
    { tone: 'compare', label: 'mismatch' },
    { tone: 'frontier', label: 'known match (prefix, reused)' },
    { tone: 'visited', label: 'suffix' },
    { tone: 'swap', label: 'lps value written' },
    { tone: 'path', label: 'lps entry used / slide' },
    { tone: 'found', label: 'occurrence' },
  ],
  Glyph,
});
