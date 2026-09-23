import { useLayoutEffect, useMemo, useRef } from 'react';
import { tokenize, type CodeLine, type Lang } from '@/core/code';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'js', label: 'JavaScript' },
  { id: 'py', label: 'Python' },
];

const LINE_H = 22;

export function CodePanel({
  lines,
  lang,
  onLang,
  activeTags,
  breakpoints,
  onToggleBreakpoint,
}: {
  lines: CodeLine[];
  lang: Lang;
  onLang: (l: Lang) => void;
  activeTags: string[];
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const active = useMemo(() => lines.map((l, i) => (l.tags.some((t) => activeTags.includes(t)) ? i : -1)).filter((i) => i >= 0), [lines, activeTags]);
  const first = active[0] ?? -1;
  const tokens = useMemo(() => lines.map((l) => tokenize(l.text, lang)), [lines, lang]);

  // keep the highlighted line visible without scrolling the page
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || first < 0) return;
    const top = first * LINE_H;
    const bottom = (active[active.length - 1] + 1) * LINE_H;
    if (top < el.scrollTop + 8 || bottom > el.scrollTop + el.clientHeight - 8)
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
  }, [first, active]);

  return (
    <section className="panel code-panel">
      <header className="panel-head">
        <span className="panel-title">Code</span>
        <div className="seg seg-sm" role="tablist">
          {LANGS.map((l) => (
            <button key={l.id} role="tab" aria-selected={lang === l.id} className={`seg-btn ${lang === l.id ? 'on' : ''}`} onClick={() => onLang(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </header>
      <div className="code-scroll" ref={scroller}>
        <div className="code-inner" style={{ ['--lh' as string]: `${LINE_H}px` }}>
          {active.map((i) => (
            <div key={`hl${i === first ? 'first' : i}`} className={`code-hl ${i === first ? 'primary' : ''}`} style={{ transform: `translateY(${i * LINE_H}px)` }} />
          ))}
          {lines.map((l, i) => (
            <div key={i} className={`code-line ${active.includes(i) ? 'on' : ''}`}>
              <button
                className={`code-gutter ${breakpoints.has(i) ? 'bp' : ''} ${l.tags.length ? 'can' : ''}`}
                onClick={() => l.tags.length && onToggleBreakpoint(i)}
                title={l.tags.length ? (breakpoints.has(i) ? 'Remove breakpoint' : 'Pause here during playback') : undefined}
                tabIndex={l.tags.length ? 0 : -1}
              >
                {i + 1}
              </button>
              <code>
                {tokens[i].map((t, k) => (
                  <span key={k} className={`tk-${t.k}`}>
                    {t.t}
                  </span>
                ))}
                {!l.text && ' '}
              </code>
            </div>
          ))}
        </div>
      </div>
      <footer className="panel-foot">Click a line number to set a breakpoint — playback pauses when it gets there.</footer>
    </section>
  );
}
