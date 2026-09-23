import type { AlgorithmDef, CategoryId } from './types';

export interface CategoryMeta {
  id: CategoryId;
  name: string;
  blurb: string;
  hue: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'basic', name: 'Foundations', blurb: 'Compression, number theory and set bookkeeping.', hue: 'var(--amber)' },
  { id: 'searching', name: 'Searching', blurb: 'Finding a needle — in lists, trees and graphs.', hue: 'var(--sky)' },
  { id: 'sorting', name: 'Sorting', blurb: 'Putting things in order, seven different ways of thinking.', hue: 'var(--coral)' },
  { id: 'arrays', name: 'Arrays & Strings', blurb: 'Clever single passes, pointers and patterns.', hue: 'var(--mint)' },
  { id: 'graphs', name: 'Graphs & Grids', blurb: 'Shortest paths, spanning trees and spreading paint.', hue: 'var(--violet)' },
];

const modules = import.meta.glob<{ default: AlgorithmDef }>('../algorithms/**/*.tsx', { eager: true });

export const ALGORITHMS: AlgorithmDef[] = Object.values(modules)
  .map((m) => m.default)
  .filter((d): d is AlgorithmDef => !!d && typeof d === 'object' && 'id' in d)
  .sort(
    (a, b) =>
      CATEGORIES.findIndex((c) => c.id === a.category) - CATEGORIES.findIndex((c) => c.id === b.category) ||
      a.order - b.order,
  );

export const byCategory = (id: CategoryId) => ALGORITHMS.filter((a) => a.category === id);
export const findAlgorithm = (id: string) => ALGORITHMS.find((a) => a.id === id);
