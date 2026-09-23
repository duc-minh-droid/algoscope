import type { InputSpec, Tone } from '@/core/types';
import { formatNumberList, parseNumberList, randInt, randomArray } from '@/core/utils';

/** Shared helpers for insertion / selection / heap / counting sort. */

export interface ListInputOpts {
  def: number[];
  min: number;
  max: number;
  maxLen: number;
  randLen: [number, number];
  /** Override the edge-case presets (defaults: sorted, reversed, duplicates, single). */
  presets?: { name: string; value: number[] }[];
}

export function listInput(o: ListInputOpts): InputSpec<number[]> {
  const sorted = [...o.def].sort((a, b) => a - b);
  return {
    default: o.def,
    presets: o.presets ?? [
      { name: 'Already sorted', value: sorted },
      { name: 'Reversed', value: [...sorted].reverse() },
      { name: 'Duplicates', value: dupes(o.min, o.max) },
      { name: 'Single element', value: [o.def[0]] },
    ],
    random: () => randomArray(randInt(o.randLen[0], o.randLen[1]), o.min, o.max),
    format: (v) => formatNumberList(v),
    parse: (text) => {
      if (!text.trim()) throw new Error('Type a few numbers, e.g. "5, 2, 9, 1".');
      return parseNumberList(text, { min: o.min, max: o.max, minLen: 1, maxLen: o.maxLen, integer: true });
    },
    placeholder: o.def.join(', '),
    hint: `Whole numbers ${o.min}–${o.max}, separated by commas or spaces. 1–${o.maxLen} values.`,
  };
}

function dupes(min: number, max: number) {
  const span = max - min;
  const a = min + Math.round(span * 0.3);
  const b = min + Math.round(span * 0.6);
  const c = min + Math.round(span * 0.15);
  return [b, a, b, c, a, b, c, a];
}

/** Front positions of the celebratory left-to-right sweep (a 3-wide band). */
export function sweepFronts(n: number): number[] {
  const out: number[] = [];
  for (let f = 1; f < n + 2; f += 3) out.push(f);
  return out;
}

export const inSweep = (k: number, front: number) => front >= 0 && k <= front && k > front - 3;

/** Tone for an index during the final sweep / done state. */
export const finalTone = (k: number, front: number): Tone => (inSweep(k, front) ? 'found' : 'done');

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
