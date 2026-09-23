import { ALGORITHMS, byCategory, CATEGORIES } from '@/core/registry';
import { hrefFor } from '@/core/route';
import type { CategoryId } from '@/core/types';
import { HeroArt } from './HeroArt';
import { IconArrow } from './icons';

function FallbackGlyph({ cat }: { cat: CategoryId }) {
  if (cat === 'sorting' || cat === 'arrays')
    return (
      <svg viewBox="0 0 120 80" className="glyph">
        {[30, 55, 20, 65, 42].map((h, i) => (
          <rect key={i} x={14 + i * 20} y={70 - h} width={14} height={h} rx={3} className="glyph-bar" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </svg>
    );
  return (
    <svg viewBox="0 0 120 80" className="glyph">
      <path d="M25 40 L60 18 L95 40 L60 62 Z M60 18 L60 62" className="glyph-line" pathLength={1} />
      {[
        [25, 40],
        [60, 18],
        [95, 40],
        [60, 62],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={7} className="glyph-dot" style={{ animationDelay: `${i * 200}ms` }} />
      ))}
    </svg>
  );
}

export function Home() {
  const first = ALGORITHMS.find((a) => a.id === 'quick-sort') ?? ALGORITHMS[0];
  let n = 0;
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">An atlas of {ALGORITHMS.length} algorithms</p>
          <h1>
            Watch algorithms <em>think</em>.
          </h1>
          <p className="hero-sub">
            Every step drawn out, every line of code lit up as it runs. Pause anywhere, rewind, set breakpoints, and feed in your own test cases.
          </p>
          <div className="hero-cta">
            {first && (
              <a className="btn primary lg" href={hrefFor(first.id)}>
                Start with {first.name} <IconArrow width={16} height={16} />
              </a>
            )}
            <a className="btn ghost lg" href="#atlas" onClick={(e) => (e.preventDefault(), document.getElementById('atlas')?.scrollIntoView({ behavior: 'smooth' }))}>
              Browse the atlas
            </a>
          </div>
        </div>
        <HeroArt />
      </section>

      <div id="atlas" className="atlas">
        {CATEGORIES.map((c, ci) => {
          const list = byCategory(c.id);
          if (!list.length) return null;
          return (
            <section key={c.id} className="atlas-cat" style={{ ['--hue' as string]: c.hue }}>
              <header>
                <span className="atlas-num">0{ci + 1}</span>
                <h2>{c.name}</h2>
                <p>{c.blurb}</p>
              </header>
              <div className="cards">
                {list.map((a) => {
                  const G = a.Glyph;
                  return (
                    <a key={a.id} href={hrefFor(a.id)} className="card" style={{ animationDelay: `${Math.min(n++, 20) * 40}ms` }}>
                      <div className="card-glyph">{G ? <G /> : <FallbackGlyph cat={a.category} />}</div>
                      <div className="card-body">
                        <h3>{a.name}</h3>
                        <p>{a.tagline}</p>
                        <span className="card-cx">{a.complexity.time}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <footer className="home-foot">Drawn with SVG. Keyboard: Space to play, ← → to step.</footer>
    </div>
  );
}
