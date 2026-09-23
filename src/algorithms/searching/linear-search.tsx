import { defineAlgorithm, type Frame, type Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt, randomArray } from '@/core/utils';
import { ArrayView, Callout, StatRow, VizStack } from '@/viz';

interface Input {
  arr: number[];
  target: number;
}

interface State {
  arr: number[];
  i: number; // index being inspected (-1 before start)
  found: number; // index of hit, -1 if none yet
  done: boolean;
  checks: number;
}

function* run({ arr, target }: Input): Generator<Frame<State>> {
  const s = (i: number, found: number, done: boolean, checks: number): State => ({ arr: [...arr], i, found, done, checks });
  yield {
    state: s(-1, -1, false, 0),
    line: 'fn',
    note: `Looking for **${target}**. Linear search makes no assumptions — it just walks the list from the left.`,
    vars: { target, i: undefined },
    phase: 'scan',
  };
  for (let i = 0; i < arr.length; i++) {
    yield { state: s(i, -1, false, i), line: 'loop', note: `Move to index **${i}**.`, vars: { target, i, 'arr[i]': arr[i] }, phase: 'scan' };
    const hit = arr[i] === target;
    yield {
      state: s(i, -1, false, i + 1),
      line: 'cmp',
      note: hit ? `\`${arr[i]} === ${target}\` — a match!` : `\`${arr[i]} ≠ ${target}\`, keep going.`,
      vars: { target, i, 'arr[i]': arr[i] },
      phase: 'scan',
    };
    if (hit) {
      yield {
        state: s(i, i, true, i + 1),
        line: 'found',
        note: `Found **${target}** at index **${i}** after ${i + 1} comparison${i ? 's' : ''}.`,
        vars: { target, i, result: i },
        phase: 'done',
      };
      return;
    }
  }
  yield {
    state: s(arr.length, -1, true, arr.length),
    line: 'miss',
    note: `Checked all ${arr.length} values — **${target}** isn't here, so return \`-1\`.`,
    vars: { target, i: arr.length, result: -1 },
    phase: 'done',
  };
}

function View({ frame }: { frame: Frame<State> }) {
  const { arr, i, found, done, checks } = frame.state;
  const tone = (k: number): Tone | undefined => (k === found ? 'found' : k === i ? 'active' : k < i ? 'muted' : undefined);
  return (
    <VizStack gap={26}>
      <StatRow stats={[{ label: 'comparisons', value: checks }, { label: 'left to check', value: found >= 0 ? 0 : arr.length - checks }]} />
      <ArrayView items={arr} tones={tone} pointers={[{ index: i, label: 'i', tone: found >= 0 ? 'found' : 'active' }]} cell={58} />
      <Callout show={done} tone={found >= 0 ? 'found' : 'danger'}>
        {found >= 0 ? `return ${found}` : 'return -1'}
      </Callout>
    </VizStack>
  );
}

function Glyph() {
  return (
    <svg viewBox="0 0 120 80" className="glyph-ls">
      {[0, 1, 2, 3, 4].map((k) => (
        <rect key={k} x={8 + k * 22} y={30} width={18} height={18} rx={4} fill="var(--ink-3)" stroke="currentColor" strokeOpacity={0.4} />
      ))}
      <rect x={8} y={30} width={18} height={18} rx={4} fill="currentColor">
        <animate attributeName="x" values="8;30;52;74;74" keyTimes="0;0.25;0.5;0.75;1" dur="3s" repeatCount="indefinite" calcMode="discrete" />
        <animate attributeName="fill" values="#6cb6ff;#6cb6ff;#6cb6ff;#c6f36b;#c6f36b" keyTimes="0;0.25;0.5;0.75;1" dur="3s" repeatCount="indefinite" calcMode="discrete" />
      </rect>
      <path d="M17 62 l-5 6 h10 z" fill="var(--amber)">
        <animateTransform attributeName="transform" type="translate" values="0 0;22 0;44 0;66 0;66 0" keyTimes="0;0.25;0.5;0.75;1" dur="3s" repeatCount="indefinite" calcMode="discrete" />
      </path>
    </svg>
  );
}

export default defineAlgorithm<Input, State>({
  id: 'linear-search',
  name: 'Linear Search',
  category: 'searching',
  order: 1,
  tagline: 'Check every element, one by one, until you hit the target.',
  description:
    'The simplest search there is: start at the first element and compare each one with the **target**. It works on any list — sorted or not — but in the worst case it has to look at **every** element.',
  howItWorks: ['Start at index `0`.', 'Compare the current element with the target.', 'If they match, return the index.', 'Otherwise step right; if you fall off the end, return `-1`.'],
  complexity: { time: 'O(n)', space: 'O(1)', note: 'Best case O(1) when the target is first; average n/2 comparisons.' },
  code: {
    js: `
function linearSearch(arr, target) { //@fn
  for (let i = 0; i < arr.length; i++) { //@loop
    if (arr[i] === target) { //@cmp
      return i; //@found
    }
  }
  return -1; //@miss
}`,
    py: `
def linear_search(arr, target): #@fn
    for i in range(len(arr)): #@loop
        if arr[i] == target: #@cmp
            return i #@found
    return -1 #@miss`,
  },
  input: {
    default: { arr: [14, 7, 31, 9, 22, 5, 18, 40], target: 22 },
    presets: [
      { name: 'Found in middle', value: { arr: [14, 7, 31, 9, 22, 5, 18, 40], target: 22 } },
      { name: 'First element', value: { arr: [3, 8, 1, 9], target: 3 } },
      { name: 'Not present', value: { arr: [12, 4, 19, 7, 25, 1], target: 10 } },
    ],
    random: () => {
      const arr = randomArray(randInt(6, 11), 1, 60);
      return { arr, target: Math.random() < 0.75 ? arr[randInt(0, arr.length - 1)] : randInt(61, 80) };
    },
    format: (v) => `${formatNumberList(v.arr)} | ${v.target}`,
    parse: (text) => {
      const [a, t] = text.split('|');
      if (t === undefined) throw new Error('Add the target after a "|", e.g. "4, 8, 15 | 8".');
      const arr = parseNumberList(a, { minLen: 1, maxLen: 16 });
      const [target] = parseNumberList(t, { minLen: 1, maxLen: 1 });
      return { arr, target };
    },
    placeholder: '4, 8, 15, 16, 23, 42 | 16',
    hint: 'Numbers separated by commas, then "|" and the target. Up to 16 values.',
  },
  run,
  View,
  legend: [
    { tone: 'active', label: 'checking' },
    { tone: 'muted', label: 'ruled out' },
    { tone: 'found', label: 'match' },
  ],
  Glyph,
});
