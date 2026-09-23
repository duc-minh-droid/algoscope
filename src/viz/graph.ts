import { randInt, shuffle } from '@/core/utils';

export interface GNode {
  id: string;
  x: number; // 0..GRAPH_W
  y: number; // 0..GRAPH_H
}
export interface GEdge {
  from: string;
  to: string;
  w: number;
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  source?: string;
  target?: string;
}

export const GRAPH_W = 800;
export const GRAPH_H = 460;

/** Edge key used by tone / label maps. Undirected lookups in GraphView try both orders. */
export const ek = (a: string, b: string) => `${a}->${b}`;

export const NODE_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function nextNodeId(g: Graph) {
  const used = new Set(g.nodes.map((n) => n.id));
  return NODE_NAMES.find((c) => !used.has(c)) ?? `N${g.nodes.length}`;
}

export function circleLayout(ids: string[], cx = GRAPH_W / 2, cy = GRAPH_H / 2, r = 175): GNode[] {
  return ids.map((id, i) => {
    const a = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
    return { id, x: Math.round(cx + r * 1.45 * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) };
  });
}

/** Adjacency list: id -> [{to, w}]. Undirected graphs get both directions. Neighbours sorted by id for determinism. */
export function adjacency(g: Graph, directed: boolean) {
  const adj = new Map<string, { to: string; w: number }[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) {
    adj.get(e.from)?.push({ to: e.to, w: e.w });
    if (!directed) adj.get(e.to)?.push({ to: e.from, w: e.w });
  }
  for (const l of adj.values()) l.sort((a, b) => a.to.localeCompare(b.to));
  return adj;
}

export function formatEdgeList(g: Graph, weighted: boolean) {
  const isolated = g.nodes.filter((n) => !g.edges.some((e) => e.from === n.id || e.to === n.id)).map((n) => n.id);
  return [...g.edges.map((e) => (weighted ? `${e.from} ${e.to} ${e.w}` : `${e.from} ${e.to}`)), ...isolated].join('\n');
}

/** Parses lines like "A B 4", "A-B:4", "A,B" or a lone "C" (isolated node). Keeps positions of existing nodes. */
export function parseEdgeList(text: string, prev: Graph, o: { weighted: boolean; allowNegative?: boolean; directed: boolean }): Graph {
  const edges: GEdge[] = [];
  const ids: string[] = [];
  const touch = (id: string) => {
    if (!/^[A-Za-z0-9]{1,3}$/.test(id)) throw new Error(`Node name "${id}" should be 1-3 letters/digits.`);
    if (!ids.includes(id)) ids.push(id);
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[A-Za-z0-9]+$/.test(line)) {
      touch(line);
      continue;
    }
    const m = line.match(/^([A-Za-z0-9]+)\s*(?:->|-|>|,|\s)\s*([A-Za-z0-9]+)(?:\s*[\s,:=]\s*(\S+))?$/);
    if (!m) throw new Error(`Can't read "${line}". Use "A B 4" (from, to, weight).`);
    const [, a, b, ws] = m;
    touch(a);
    touch(b);
    if (a === b) throw new Error(`Self-loop ${a}→${a} isn't supported.`);
    let w = 1;
    if (o.weighted) {
      w = ws === undefined ? 1 : Number(ws);
      if (!Number.isFinite(w)) throw new Error(`Weight "${ws}" on ${a}-${b} is not a number.`);
      if (!o.allowNegative && w < 0) throw new Error(`Negative weight on ${a}-${b} isn't allowed here.`);
    }
    const dup = edges.find((e) => (e.from === a && e.to === b) || (!o.directed && e.from === b && e.to === a));
    if (dup) throw new Error(`Edge ${a}-${b} appears twice.`);
    edges.push({ from: a, to: b, w });
  }
  if (ids.length > 14) throw new Error('Keep it to 14 nodes or fewer.');
  const fresh = circleLayout(ids);
  const nodes = ids.map((id, i) => prev.nodes.find((n) => n.id === id) ?? fresh[i]);
  return { nodes, edges, source: ids.includes(prev.source ?? '') ? prev.source : ids[0], target: ids.includes(prev.target ?? '') ? prev.target : ids[ids.length - 1] };
}

export interface RandomGraphOpts {
  n?: number;
  directed?: boolean;
  weighted?: boolean;
  acyclic?: boolean;
  allowNegative?: boolean;
  density?: number; // extra edges beyond a spanning tree, as a fraction
  minW?: number;
  maxW?: number;
}

/** Random connected graph with a pleasant, jittered layout. */
export function randomGraph(o: RandomGraphOpts = {}): Graph {
  const { n = randInt(6, 8), directed = false, weighted = true, acyclic = false, allowNegative = false, density = 0.5, minW = 1, maxW = 9 } = o;
  const ids = NODE_NAMES.slice(0, n);
  const cols = Math.ceil(Math.sqrt(n * 1.7));
  const rows = Math.ceil(n / cols);
  const slots = shuffle(Array.from({ length: cols * rows }, (_, i) => i)).slice(0, n).sort((a, b) => a - b);
  const nodes = ids.map((id, i) => {
    const s = slots[i];
    const c = s % cols;
    const r = Math.floor(s / cols);
    return {
      id,
      x: Math.round(90 + (c + 0.5) * ((GRAPH_W - 180) / cols) + randInt(-25, 25)),
      y: Math.round(60 + (r + 0.5) * ((GRAPH_H - 120) / rows) + randInt(-20, 20)),
    };
  });
  const dist = (a: GNode, b: GNode) => Math.hypot(a.x - b.x, a.y - b.y);
  const weight = () => {
    const w = randInt(minW, maxW);
    return allowNegative && Math.random() < 0.2 ? -randInt(1, 3) : w;
  };
  const edges: GEdge[] = [];
  const has = (a: string, b: string) => edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  const order = ids; // topological order for acyclic graphs
  const add = (a: string, b: string) => {
    if (a === b || has(a, b)) return;
    let [f, t] = [a, b];
    if (acyclic ? order.indexOf(f) > order.indexOf(t) : directed && Math.random() < 0.5) [f, t] = [t, f];
    edges.push({ from: f, to: t, w: weighted ? weight() : 1 });
  };
  // spanning tree connecting each node to its nearest already-connected node
  for (let i = 1; i < n; i++) {
    const near = nodes.slice(0, i).sort((a, b) => dist(a, nodes[i]) - dist(b, nodes[i]));
    add(near[randInt(0, Math.min(1, near.length - 1))].id, nodes[i].id);
  }
  const extra = Math.round(n * density);
  for (let k = 0, tries = 0; k < extra && tries < 60; tries++) {
    const a = nodes[randInt(0, n - 1)];
    const b = nodes.filter((x) => x !== a).sort((p, q) => dist(p, a) - dist(q, a))[randInt(0, 2)];
    if (b && !has(a.id, b.id)) {
      add(a.id, b.id);
      k++;
    }
  }
  return { nodes, edges, source: ids[0], target: ids[n - 1] };
}
