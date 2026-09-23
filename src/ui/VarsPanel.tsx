import type { VarValue } from '@/core/types';

const show = (v: VarValue): string => {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  return String(v);
};

export function VarsPanel({ vars, prev }: { vars?: Record<string, VarValue>; prev?: Record<string, VarValue> }) {
  const entries = Object.entries(vars ?? {});
  return (
    <section className="panel vars-panel">
      <header className="panel-head">
        <span className="panel-title">Watch</span>
        <span className="panel-sub">variables at this step</span>
      </header>
      {entries.length === 0 ? (
        <p className="vars-empty">Nothing to watch yet.</p>
      ) : (
        <dl className="vars">
          {entries.map(([k, v]) => {
            const s = show(v);
            const changed = prev !== undefined && show(prev[k]) !== s;
            return (
              <div key={k} className="var">
                <dt>{k}</dt>
                <dd key={changed ? `${s}~` : s} className={changed ? 'changed' : ''} title={s}>
                  {s}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
