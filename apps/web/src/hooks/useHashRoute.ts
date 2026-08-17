import { useEffect, useState } from 'react';

export type Route =
  | { name: 'scenarios' }
  | { name: 'scenario'; id: string }
  | { name: 'record' }
  | { name: 'runs' }
  | { name: 'run'; id: string }
  | { name: 'machines' };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'machines') return { name: 'machines' };
  if (path === 'record') return { name: 'record' };
  if (path === 'runs') return { name: 'runs' };
  const runMatch = /^runs\/(.+)$/.exec(path);
  if (runMatch?.[1]) return { name: 'run', id: runMatch[1] };
  const match = /^scenarios\/(.+)$/.exec(path);
  if (match?.[1]) return { name: 'scenario', id: match[1] };
  return { name: 'scenarios' };
}

/**
 * Hash routing instead of a router dependency. Three routes do not justify one,
 * and the hash keeps the server free of any static-hosting rewrite rules.
 */
export function useHashRoute(): [Route, (to: string) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return [route, (to: string) => { window.location.hash = to; }];
}
