import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AlgorithmDef } from '@/core/types';
import { collectFrames, stepTransition, usePlayer } from '@/core/player';
import { parseCode, type Lang } from '@/core/code';
import { CATEGORIES } from '@/core/registry';
import { Rich } from '@/viz/bits';
import { toneFill, TONE_LABEL } from '@/viz/tones';
import { CodePanel } from './CodePanel';
import { VarsPanel } from './VarsPanel';
import { Transport, type TimelineMark } from './Transport';
import { InputPanel } from './InputPanel';
import { IconEdit } from './icons';

const tagsOf = (line: string | string[] | undefined) => (line === undefined ? [] : Array.isArray(line) ? line : [line]);

export function AlgorithmPage({ def }: { def: AlgorithmDef }) {
  const [input, setInput] = useState<unknown>(def.input.default);
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('algoscope.lang') as Lang) || 'js');
  const [bps, setBps] = useState<Set<number>>(new Set());
  const [editOpen, setEditOpen] = useState(false);

  const trace = useMemo(() => collectFrames(def, input), [def, input]);
  const lines = useMemo(() => parseCode(def.code[lang]), [def, lang]);
  const total = Math.max(1, trace.frames.length);

  const bpTags = useMemo(() => new Set([...bps].flatMap((i) => lines[i]?.tags ?? [])), [bps, lines]);
  const hitsBp = useCallback((i: number) => tagsOf(trace.frames[i]?.line).some((t) => bpTags.has(t)), [trace, bpTags]);
  const breakIdx = useMemo(() => (bpTags.size ? trace.frames.map((_, i) => i).filter(hitsBp) : []), [trace, bpTags, hitsBp]);

  const player = usePlayer(total, trace, hitsBp);
  const frame = trace.frames[Math.min(player.index, trace.frames.length - 1)];
  const prev = player.index > 0 ? trace.frames[player.index - 1] : undefined;

  const marks = useMemo<TimelineMark[]>(() => {
    const out: TimelineMark[] = [];
    trace.frames.forEach((f, i) => {
      if (f.phase && f.phase !== out[out.length - 1]?.label) out.push({ index: i, label: f.phase });
    });
    return out;
  }, [trace]);

  useEffect(() => localStorage.setItem('algoscope.lang', lang), [lang]);
  useEffect(() => setBps(new Set()), [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === ' ' && !t.closest('button')) (e.preventDefault(), player.toggle());
      else if (k === 'ArrowRight') (e.preventDefault(), player.step(1));
      else if (k === 'ArrowLeft') (e.preventDefault(), player.step(-1));
      else if (k === 'Home') (e.preventDefault(), player.step(-Infinity));
      else if (k === 'End') (e.preventDefault(), player.step(Infinity));
      else if (k === ']') player.bumpSpeed(1);
      else if (k === '[') player.bumpSpeed(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const cat = CATEGORIES.find((c) => c.id === def.category)!;
  const View = def.View;

  return (
    <div className="algo" style={{ ['--step-ms' as string]: `${stepTransition(player.speed)}ms`, ['--hue' as string]: cat.hue }}>
      <header className="algo-head">
        <div className="crumbs">
          <a href="#/">Atlas</a>
          <span>/</span>
          <span style={{ color: cat.hue }}>{cat.name}</span>
        </div>
        <div className="algo-title-row">
          <div>
            <h1 className="algo-title">{def.name}</h1>
            <p className="algo-tagline">{def.tagline}</p>
          </div>
          <div className="complexity">
            <span className="cx">
              <i>time</i>
              {def.complexity.time}
            </span>
            <span className="cx">
              <i>space</i>
              {def.complexity.space}
            </span>
          </div>
        </div>
      </header>

      <div className="testcase-bar">
        <button className={`btn ${editOpen ? 'primary' : 'ghost'}`} onClick={() => setEditOpen((o) => !o)} aria-expanded={editOpen}>
          <IconEdit width={16} height={16} /> {editOpen ? 'Close test case editor' : 'Edit test case'}
        </button>
        {!editOpen && def.input.format && <code className="testcase-preview">{def.input.format(input as never)}</code>}
        {trace.truncated && <span className="warn-pill">Long run — showing the first {trace.frames.length} steps</span>}
      </div>
      <InputPanel spec={def.input} value={input} onApply={(v) => setInput(v)} open={editOpen} />

      <div className="algo-grid">
        <section className="stage-card">
          <div className="stage-top">
            {def.legend && (
              <ul className="legend">
                {def.legend.map((l) => (
                  <li key={l.label}>
                    <i style={{ background: toneFill(l.tone) }} />
                    {l.label || TONE_LABEL[l.tone]}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="stage">
            {trace.error ? (
              <div className="stage-error">
                <b>That input broke the run.</b>
                <span>{trace.error}</span>
              </div>
            ) : frame ? (
              <View frame={frame} input={input} index={player.index} total={total} />
            ) : null}
          </div>
        </section>

        <aside className="side-col">
          <CodePanel
            lines={lines}
            lang={lang}
            onLang={setLang}
            activeTags={tagsOf(frame?.line)}
            breakpoints={bps}
            onToggleBreakpoint={(i) =>
              setBps((s) => {
                const n = new Set(s);
                if (n.has(i)) n.delete(i);
                else n.add(i);
                return n;
              })
            }
          />
          <VarsPanel vars={frame?.vars} prev={prev?.vars} />
        </aside>
      </div>

      <div className="dock">
        <div className="narration" aria-live="polite">
          <span className="narration-step">{String(player.index + 1).padStart(2, '0')}</span>
          <p key={player.index}>
            <Rich text={frame?.note ?? ''} />
          </p>
        </div>
        <Transport player={player} total={total} marks={marks} breakIdx={breakIdx} />
      </div>

      <section className="explainer">
        <div>
          <h2>The idea</h2>
          <p>
            <Rich text={def.description} />
          </p>
          {def.complexity.note && (
            <p className="explainer-note">
              <Rich text={def.complexity.note} />
            </p>
          )}
        </div>
        {def.howItWorks && (
          <ol className="how">
            {def.howItWorks.map((h, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                <p>
                  <Rich text={h} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
