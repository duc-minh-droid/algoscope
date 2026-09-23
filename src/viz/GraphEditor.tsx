import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import type { EditorProps } from '@/core/types';
import { randInt } from '@/core/utils';
import { circleLayout, ek, formatEdgeList, GRAPH_H, GRAPH_W, nextNodeId, parseEdgeList, randomGraph, type Graph, type RandomGraphOpts } from './graph';
import { edgeGeometry } from './GraphView';

export interface GraphEditorOptions {
  directed: boolean;
  weighted: boolean;
  allowNegative?: boolean;
  pickSource?: boolean;
  pickTarget?: boolean;
  maxNodes?: number;
  /** Options passed to randomGraph for the dice button. */
  random?: RandomGraphOpts;
}

type Mode = 'move' | 'connect' | 'erase' | 'source' | 'target';

/** Build an input Editor for graph-based algorithms: `input: { Editor: makeGraphEditor({...}) }`. */
export function makeGraphEditor(opts: GraphEditorOptions) {
  return function Editor(p: EditorProps<Graph>) {
    return <GraphEditor {...p} {...opts} />;
  };
}

export function GraphEditor({
  value: g,
  onChange,
  directed,
  weighted,
  allowNegative,
  pickSource,
  pickTarget,
  maxNodes = 14,
  random,
}: EditorProps<Graph> & GraphEditorOptions) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>('move');
  const [drag, setDrag] = useState<{ id: string; kind: 'move' | 'link'; x: number; y: number } | null>(null);
  const [editEdge, setEditEdge] = useState<number | null>(null);
  const [text, setText] = useState(() => formatEdgeList(g, weighted));
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatEdgeList(g, weighted));
  }, [g, weighted, focused]);

  const pt = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.max(26, Math.min(GRAPH_W - 26, p.x)), y: Math.max(26, Math.min(GRAPH_H - 26, p.y)) };
  };

  const nodeAt = (x: number, y: number) => g.nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 26);

  const addNode = (x: number, y: number) => {
    if (g.nodes.length >= maxNodes) return setErr(`Max ${maxNodes} nodes.`);
    const id = nextNodeId(g);
    onChange({ ...g, nodes: [...g.nodes, { id, x: Math.round(x), y: Math.round(y) }], source: g.source ?? id });
  };

  const removeNode = (id: string) => {
    const nodes = g.nodes.filter((n) => n.id !== id);
    onChange({
      nodes,
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
      source: g.source === id ? nodes[0]?.id : g.source,
      target: g.target === id ? nodes[nodes.length - 1]?.id : g.target,
    });
  };

  const onDown = (e: RPE<SVGSVGElement>) => {
    const { x, y } = pt(e);
    const hit = nodeAt(x, y);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === 'erase') return removeNode(hit.id);
    if (mode === 'source') return onChange({ ...g, source: hit.id });
    if (mode === 'target') return onChange({ ...g, target: hit.id });
    setDrag({ id: hit.id, kind: mode === 'connect' || e.shiftKey ? 'link' : 'move', x, y });
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    if (!drag) return;
    const { x, y } = pt(e);
    if (drag.kind === 'move') {
      onChange({ ...g, nodes: g.nodes.map((n) => (n.id === drag.id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)) });
    } else setDrag({ ...drag, x, y });
  };

  const onUp = (e: RPE<SVGSVGElement>) => {
    if (drag?.kind === 'link') {
      const { x, y } = pt(e);
      const to = nodeAt(x, y);
      if (to && to.id !== drag.id) {
        const exists = g.edges.some((ed) => (ed.from === drag.id && ed.to === to.id) || (!directed && ed.from === to.id && ed.to === drag.id));
        if (!exists) onChange({ ...g, edges: [...g.edges, { from: drag.id, to: to.id, w: weighted ? randInt(1, 9) : 1 }] });
      }
    }
    setDrag(null);
  };

  const onDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    const { x, y } = pt(e);
    if (!nodeAt(x, y)) addNode(x, y);
  };

  const applyText = () => {
    try {
      onChange(parseEdgeList(text, g, { weighted, allowNegative, directed }));
      setErr(null);
    } catch (ex) {
      setErr((ex as Error).message);
    }
  };

  const pos = new Map(g.nodes.map((n) => [n.id, n]));
  const pair = new Set(g.edges.map((e) => ek(e.from, e.to)));
  const editing = editEdge !== null ? g.edges[editEdge] : null;
  const editGeo = editing && pos.get(editing.from) && pos.get(editing.to) ? edgeGeometry(pos.get(editing.from)!, pos.get(editing.to)!, !!directed && pair.has(ek(editing.to, editing.from))) : null;

  const modes: { id: Mode; label: string; hint: string }[] = [
    { id: 'move', label: 'Move', hint: 'Drag nodes. Double-click empty space to add a node. Click a weight to edit it.' },
    { id: 'connect', label: 'Connect', hint: 'Drag from one node to another to add an edge.' },
    { id: 'erase', label: 'Erase', hint: 'Click a node or an edge to delete it.' },
    ...(pickSource ? [{ id: 'source' as Mode, label: 'Start', hint: 'Click the node to start from.' }] : []),
    ...(pickTarget ? [{ id: 'target' as Mode, label: 'Goal', hint: 'Click the destination node.' }] : []),
  ];

  return (
    <div className="ge">
      <div className="ge-toolbar">
        <div className="seg">
          {modes.map((m) => (
            <button key={m.id} className={`seg-btn ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="ge-actions">
          <button className="btn ghost sm" onClick={() => addNode(randInt(80, GRAPH_W - 80), randInt(60, GRAPH_H - 60))}>
            + Node
          </button>
          <button className="btn ghost sm" onClick={() => onChange({ ...g, nodes: circleLayout(g.nodes.map((n) => n.id)) })}>
            Tidy
          </button>
          <button className="btn ghost sm" onClick={() => onChange(randomGraph({ directed, weighted, allowNegative, ...random }))}>
            Shuffle
          </button>
          <button className="btn ghost sm" onClick={() => onChange({ nodes: [], edges: [] })}>
            Clear
          </button>
        </div>
      </div>
      <p className="ge-hint">{modes.find((m) => m.id === mode)?.hint}</p>

      <div className="ge-body">
        <div className="ge-canvas" data-mode={mode}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onDoubleClick={onDouble}
          >
            {g.edges.map((e, i) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              const geo = edgeGeometry(a, b, !!directed && pair.has(ek(e.to, e.from)));
              return (
                <g key={ek(e.from, e.to)} className="ge-edge" onPointerDown={(ev) => mode === 'erase' && (ev.stopPropagation(), onChange({ ...g, edges: g.edges.filter((_, j) => j !== i) }))}>
                  <path d={geo.d} className="ge-edge-hit" />
                  <path d={geo.d} className="ge-edge-line" />
                  {directed && <path d="M0 0 L-11 -5.5 L-11 5.5 Z" className="ge-arrow" transform={`translate(${geo.ex} ${geo.ey}) rotate(${(geo.ang * 180) / Math.PI})`} />}
                  {weighted && (
                    <g
                      transform={`translate(${geo.lx} ${geo.ly})`}
                      className="ge-w"
                      onPointerDown={(ev) => {
                        if (mode !== 'move') return;
                        ev.stopPropagation();
                        setEditEdge(i);
                      }}
                    >
                      <rect x={-14} y={-11} width={28} height={22} rx={11} />
                      <text y={4.5}>{e.w}</text>
                    </g>
                  )}
                </g>
              );
            })}
            {drag?.kind === 'link' && pos.get(drag.id) && (
              <line className="ge-rubber" x1={pos.get(drag.id)!.x} y1={pos.get(drag.id)!.y} x2={drag.x} y2={drag.y} />
            )}
            {g.nodes.map((n) => (
              <g key={n.id} className="ge-node" transform={`translate(${n.x} ${n.y})`} data-drag={drag?.id === n.id ? '' : undefined}>
                <circle r={22} />
                <text y={6}>{n.id}</text>
                {g.source === n.id && (pickSource || pickTarget) && <NodeFlag label="start" tone="var(--mint)" />}
                {g.target === n.id && pickTarget && <NodeFlag label="goal" tone="var(--coral)" below />}
              </g>
            ))}
          </svg>
          {editing && editGeo && (
            <input
              className="ge-w-input"
              autoFocus
              type="number"
              defaultValue={editing.w}
              style={{ left: `${(editGeo.lx / GRAPH_W) * 100}%`, top: `${(editGeo.ly / GRAPH_H) * 100}%` }}
              onBlur={(ev) => {
                const w = Number(ev.currentTarget.value);
                if (Number.isFinite(w) && (allowNegative || w >= 0))
                  onChange({ ...g, edges: g.edges.map((ed, j) => (j === editEdge ? { ...ed, w } : ed)) });
                setEditEdge(null);
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') ev.currentTarget.blur();
                if (ev.key === 'Escape') setEditEdge(null);
              }}
            />
          )}
          {g.nodes.length === 0 && <div className="ge-empty">Double-click anywhere to drop your first node</div>}
        </div>

        <label className="ge-text">
          <span className="field-label">Edge list {weighted ? '(from to weight)' : '(from to)'}</span>
          <textarea
            value={text}
            spellCheck={false}
            onFocus={() => setFocused(true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              setFocused(false);
              applyText();
            }}
            rows={9}
          />
          {err ? <span className="field-err">{err}</span> : <span className="field-hint">Edits apply when you click away.</span>}
        </label>
      </div>
    </div>
  );
}

function NodeFlag({ label, tone, below }: { label: string; tone: string; below?: boolean }) {
  return (
    <g transform={`translate(0 ${below ? 40 : -40})`} className="ge-flag">
      <rect x={-22} y={-10} width={44} height={19} rx={9.5} style={{ fill: tone }} />
      <text y={4}>{label}</text>
    </g>
  );
}
