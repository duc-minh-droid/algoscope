import { useEffect, useState } from 'react';

export type Route = { page: 'home' } | { page: 'algo'; id: string };

const parse = (): Route => {
  const m = location.hash.match(/^#\/algo\/([\w-]+)/);
  return m ? { page: 'algo', id: m[1] } : { page: 'home' };
};

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const hrefFor = (id: string) => `#/algo/${id}`;
