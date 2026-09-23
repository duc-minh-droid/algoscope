import { useEffect, useState } from 'react';
import { useRoute } from './core/route';
import { findAlgorithm } from './core/registry';
import { Sidebar } from './ui/Sidebar';
import { Home } from './ui/Home';
import { AlgorithmPage } from './ui/AlgorithmPage';
import { IconMenu } from './ui/icons';

export function App() {
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const def = route.page === 'algo' ? findAlgorithm(route.id) : undefined;

  useEffect(() => {
    setNavOpen(false);
    document.querySelector('.main')?.scrollTo({ top: 0 });
    document.title = def ? `${def.name} — Algoscope` : 'Algoscope — watch algorithms think';
  }, [route, def]);

  return (
    <div className="app" data-nav={navOpen ? 'open' : undefined}>
      <Sidebar activeId={def?.id} onNavigate={() => setNavOpen(false)} />
      <button className="nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation">
        <IconMenu />
      </button>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        {def ? (
          <AlgorithmPage key={def.id} def={def} />
        ) : route.page === 'algo' ? (
          <div className="missing">
            <h1>Not drawn yet</h1>
            <p>
              No visualizer called <code>{route.id}</code>. <a href="#/">Back to the atlas →</a>
            </p>
          </div>
        ) : (
          <Home />
        )}
      </main>
    </div>
  );
}
