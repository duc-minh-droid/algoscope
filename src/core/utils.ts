export const clone = <T>(v: T): T => structuredClone(v);

export const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

export const randomArray = (n: number, lo = 1, hi = 99) => Array.from({ length: n }, () => randInt(lo, hi));

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export interface NumberListOpts {
  min?: number;
  max?: number;
  minLen?: number;
  maxLen?: number;
  integer?: boolean;
}

/** Parses "5, 3 8,1" into numbers. Throws Error with a friendly message. */
export function parseNumberList(text: string, o: NumberListOpts = {}): number[] {
  const { min = -999, max = 999, minLen = 1, maxLen = 20, integer = true } = o;
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length < minLen) throw new Error(`Need at least ${minLen} value${minLen > 1 ? 's' : ''}.`);
  if (parts.length > maxLen) throw new Error(`At most ${maxLen} values keep the picture readable.`);
  return parts.map((p) => {
    const n = Number(p);
    if (!Number.isFinite(n)) throw new Error(`"${p}" is not a number.`);
    if (integer && !Number.isInteger(n)) throw new Error(`"${p}" must be a whole number.`);
    if (n < min || n > max) throw new Error(`Values must be between ${min} and ${max}.`);
    return n;
  });
}

export const formatNumberList = (a: number[]) => a.join(', ');

/** Items with stable ids so primitives can animate movement (swaps, shifts). */
export interface Item<V = number> {
  id: number;
  value: V;
}
export const withIds = <V>(values: V[]): Item<V>[] => values.map((value, id) => ({ id, value }));

export const fmtInf = (n: number) => (n === Infinity ? '∞' : n === -Infinity ? '-∞' : String(n));
