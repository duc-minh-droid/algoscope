import type { ReactNode } from 'react';
import type { Tone } from '@/core/types';
import { toneFill, toneInk } from './tones';

/** Renders **bold**, *italic* and `code` inline markup. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith('`') && p.endsWith('`') ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : p.length > 2 && p.startsWith('*') && p.endsWith('*') ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Vertical stack of labelled visual sections inside a View. */
export function VizStack({ children, gap = 18 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="viz-stack" style={{ gap }}>
      {children}
    </div>
  );
}

/** Two or more panels side by side (wraps on narrow screens). */
export function VizRow({ children, gap = 18 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="viz-row" style={{ gap }}>
      {children}
    </div>
  );
}

export function VizSection({ label, aside, children }: { label?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="viz-section">
      {(label || aside) && (
        <header>
          {label && <span className="viz-label">{label}</span>}
          {aside && <span className="viz-aside">{aside}</span>}
        </header>
      )}
      <div className="viz-section-body">{children}</div>
    </section>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  tone?: Tone;
}

/** Row of big counters (comparisons, swaps, answer...). */
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-row">
      {stats.map((s) => (
        <div className="stat" key={s.label} data-tone={s.tone}>
          <span className="stat-v" style={s.tone ? { color: toneFill(s.tone) } : undefined}>
            {s.value}
          </span>
          <span className="stat-l">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Tag({ tone = 'idle', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="tag" style={{ background: toneFill(tone), color: toneInk(tone) }}>
      {children}
    </span>
  );
}

/** A big centred callout for results ("gcd = 6", "Majority: 3"). Pops in when `show` flips. */
export function Callout({ show, tone = 'found', children }: { show: boolean; tone?: Tone; children: ReactNode }) {
  return (
    <div className="callout" data-show={show ? '' : undefined} style={{ borderColor: toneFill(tone), color: toneFill(tone) }}>
      {children}
    </div>
  );
}

/** Horizontal list of small tokens (queues, stacks, output buffers). Items keyed by `id` animate in. */
export function TokenStrip({
  items,
  empty = 'empty',
  label,
}: {
  items: { id: string | number; text: ReactNode; tone?: Tone }[];
  empty?: string;
  label?: string;
}) {
  return (
    <div className="token-strip">
      {label && <span className="token-strip-l">{label}</span>}
      <div className="token-strip-items">
        {items.length === 0 && <span className="token-empty">{empty}</span>}
        {items.map((t) => (
          <span key={t.id} className="token" style={{ background: toneFill(t.tone ?? 'idle'), color: toneInk(t.tone ?? 'idle') }}>
            {t.text}
          </span>
        ))}
      </div>
    </div>
  );
}
