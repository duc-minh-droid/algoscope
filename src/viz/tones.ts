import type { Tone } from '@/core/types';

export const toneFill = (t: Tone = 'idle') => `var(--t-${t})`;

/** Readable text colour on top of a tone fill. */
export const toneInk = (t: Tone = 'idle') => (t === 'idle' || t === 'muted' ? 'var(--paper)' : '#0b0f18');

export const TONE_LABEL: Record<Tone, string> = {
  idle: 'untouched',
  active: 'current',
  compare: 'comparing',
  swap: 'moving',
  done: 'final',
  found: 'found',
  visited: 'visited',
  frontier: 'waiting',
  path: 'path',
  muted: 'ignored',
  danger: 'problem',
};

export type ToneMap<K extends string | number = number> = Partial<Record<K, Tone>> | ((key: K) => Tone | undefined);

export const readTone = <K extends string | number>(m: ToneMap<K> | undefined, k: K): Tone | undefined =>
  !m ? undefined : typeof m === 'function' ? m(k) : m[k];
