import { useState } from 'react';
import { ALGORITHMS, byCategory, CATEGORIES } from '@/core/registry';
import { hrefFor } from '@/core/route';
import { IconSearch } from './icons';

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brandmark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="15" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="15" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeDasharray="22 72" strokeLinecap="round" className="brandmark-arc" />
      <path d="M11 24 L16 17 L21 21 L28 12" fill="none" stroke="var(--paper)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28" cy="12" r="3" fill="var(--coral)" />
    </svg>
  );
}

export function Sidebar({ activeId, onNavigate }: { activeId?: string; onNavigate: () => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const total = ALGORITHMS.length;

  return (
    <nav className="sidebar">
      <a className="brand" href="#/" onClick={onNavigate}>
        <BrandMark />
        <span>
          <b>Algoscope</b>
          <small>{total} algorithms, drawn live</small>
        </span>
      </a>

      <label className="search">
        <IconSearch width={15} height={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an algorithm" />
        {q && (
          <button className="search-clear" onClick={() => setQ('')} aria-label="Clear search">
            ×
          </button>
        )}
      </label>

      <div className="nav-groups">
        {CATEGORIES.map((c) => {
          const list = byCategory(c.id).filter((a) => !query || a.name.toLowerCase().includes(query) || a.tagline.toLowerCase().includes(query));
          if (!list.length) return null;
          return (
            <div className="nav-group" key={c.id} style={{ ['--hue' as string]: c.hue }}>
              <div className="nav-group-title">
                <i />
                {c.name}
                <span>{list.length}</span>
              </div>
              <ul>
                {list.map((a) => (
                  <li key={a.id}>
                    <a href={hrefFor(a.id)} className={a.id === activeId ? 'on' : ''} onClick={onNavigate} aria-current={a.id === activeId ? 'page' : undefined}>
                      {a.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {query && !ALGORITHMS.some((a) => a.name.toLowerCase().includes(query) || a.tagline.toLowerCase().includes(query)) && (
          <p className="nav-empty">Nothing matches “{q}”.</p>
        )}
      </div>
    </nav>
  );
}
