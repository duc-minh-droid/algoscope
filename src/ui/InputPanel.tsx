import { useEffect, useState } from 'react';
import type { InputSpec } from '@/core/types';
import { IconDice } from './icons';

export function InputPanel<I>({ spec, value, onApply, open }: { spec: InputSpec<I>; value: I; onApply: (v: I) => void; open: boolean }) {
  const [draft, setDraft] = useState<I>(value);
  const [text, setText] = useState(() => spec.format?.(value) ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    setDraft(value);
    setText(spec.format?.(value) ?? '');
    setErr(null);
  }, [value, spec]);

  const commit = (v: I) => {
    setDraft(v);
    setText(spec.format?.(v) ?? '');
    setErr(null);
    onApply(v);
  };

  const parseText = (t: string): I | null => {
    if (!spec.parse) return draft;
    try {
      const v = spec.parse(t);
      setErr(null);
      return v;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  };

  const apply = () => {
    const v = spec.Editor ? draft : parseText(text);
    if (v !== null) onApply(v);
  };

  const dirty = spec.Editor ? draft !== value : text !== (spec.format?.(value) ?? '');
  const { Editor } = spec;

  return (
    <div className="input-panel" data-open={open ? '' : undefined} aria-hidden={!open}>
      <div className="input-panel-inner">
        <div className="input-row">
          {spec.presets && spec.presets.length > 0 && (
            <div className="presets">
              <span className="field-label">Try</span>
              {spec.presets.map((p) => (
                <button key={p.name} className="chip" onClick={() => commit(p.value)} tabIndex={open ? 0 : -1}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {spec.random && (
            <button
              className="btn ghost sm dice"
              onClick={() => {
                setSpin((s) => s + 1);
                commit(spec.random!());
              }}
              tabIndex={open ? 0 : -1}
            >
              <IconDice style={{ transform: `rotate(${spin * 180}deg)` }} /> Random
            </button>
          )}
        </div>

        {spec.parse && !Editor && (
          <div className="text-input">
            <label className="field">
              <span className="field-label">Your test case</span>
              <input
                value={text}
                placeholder={spec.placeholder}
                spellCheck={false}
                onChange={(e) => {
                  setText(e.target.value);
                  parseText(e.target.value);
                }}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                tabIndex={open ? 0 : -1}
                aria-invalid={!!err}
              />
            </label>
            <button className="btn primary" onClick={apply} disabled={!!err || !dirty} tabIndex={open ? 0 : -1}>
              Run it
            </button>
          </div>
        )}

        {Editor && (
          <div className="editor-wrap">
            <Editor value={draft} onChange={setDraft} />
            <div className="editor-foot">
              <button className="btn ghost sm" onClick={() => setDraft(value)} disabled={!dirty}>
                Revert
              </button>
              <button className="btn primary" onClick={apply} disabled={!dirty}>
                Run this test case
              </button>
            </div>
          </div>
        )}

        {err ? <p className="field-err">{err}</p> : spec.hint ? <p className="field-hint">{spec.hint}</p> : null}
      </div>
    </div>
  );
}
