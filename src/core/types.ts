import type { ComponentType } from 'react';

/** Semantic colour roles. Every visual primitive maps these to CSS vars (--t-<tone>). */
export type Tone =
  | 'idle'
  | 'active' // the thing the algorithm is looking at right now (amber)
  | 'compare' // being compared (coral)
  | 'swap' // being moved / written (magenta)
  | 'done' // finalised / sorted / settled (mint)
  | 'found' // target hit / answer (bright lime)
  | 'visited' // seen before (sky)
  | 'frontier' // queued / on stack / candidate (violet)
  | 'path' // part of the resulting path / tree (gold)
  | 'muted' // out of range / discarded (dim)
  | 'danger'; // cycle / negative / error (red)

export type CategoryId = 'basic' | 'searching' | 'sorting' | 'arrays' | 'graphs';

export type VarValue = string | number | boolean | null | undefined | (string | number)[];

export interface Frame<S> {
  /** Immutable snapshot of everything the View needs. NEVER mutate after yielding. */
  state: S;
  /** Code tag(s) to highlight. Tags are declared in the code listing with `//@tag` (js) or `#@tag` (py). */
  line?: string | string[];
  /** One or two sentences narrating this step. Supports **bold** and `code`. */
  note: string;
  /** Watch-panel variables. Changed values flash automatically. */
  vars?: Record<string, VarValue>;
  /** Optional phase label; phase changes show as marks on the timeline. */
  phase?: string;
}

export interface Preset<I> {
  name: string;
  value: I;
}

export interface EditorProps<I> {
  value: I;
  onChange: (v: I) => void;
}

export interface InputSpec<I> {
  default: I;
  presets?: Preset<I>[];
  random?: () => I;
  /** Text editing. Provide format+parse for a text box (parse throws Error with a friendly message). */
  format?: (v: I) => string;
  parse?: (text: string) => I;
  placeholder?: string;
  /** Short help shown under the input, e.g. "comma separated integers, 2–16 values". */
  hint?: string;
  /** Rich visual editor (graph canvas, grid painter...). Can be combined with text editing. */
  Editor?: ComponentType<EditorProps<I>>;
}

export interface ViewProps<I, S> {
  frame: Frame<S>;
  input: I;
  index: number;
  total: number;
}

export interface LegendItem {
  tone: Tone;
  label: string;
}

export interface AlgorithmDef<I = any, S = any> {
  id: string; // url slug, kebab-case
  name: string;
  category: CategoryId;
  order: number; // sort order within category
  tagline: string; // one line, shown under the title
  description: string; // 2-4 sentence plain-language explanation; supports **bold** and `code`
  howItWorks?: string[]; // 3-5 short bullet "big idea" steps
  complexity: { time: string; space: string; note?: string };
  code: { js: string; py: string };
  input: InputSpec<I>;
  run: (input: I) => Iterable<Frame<S>>;
  View: ComponentType<ViewProps<I, S>>;
  legend?: LegendItem[];
  /** Tiny looping animated SVG used on cards (viewBox 0 0 120 80). */
  Glyph?: ComponentType;
}

export function defineAlgorithm<I, S>(def: AlgorithmDef<I, S>): AlgorithmDef<I, S> {
  return def;
}
