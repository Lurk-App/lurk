import { useEffect, useState } from 'react';

/** The scheme on screen ("light" or "dark"), following every change (settings or system). */
export function useScheme(): 'light' | 'dark' {
  const read = () => (document.documentElement.dataset['scheme'] === 'light' ? 'light' : 'dark');
  const [scheme, setScheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
    return () => observer.disconnect();
  }, []);
  return scheme;
}

/** Whether the system asks for reduced motion, following changes. */
export function useReducedMotion(): boolean {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const [reduced, setReduced] = useState(query.matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
