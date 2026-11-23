// The search model behind the sidebar field: suggestions while typing, the highlight for the arrow
// keys, a short pause before Twitch is asked, and a cache per term.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchResults } from '@shared/models';
import { buildSuggestions, moveHighlight, searchDebounceMs, type Suggestion } from '@shared/search';

export interface SearchModel {
  text: string;
  setText(text: string): void;
  suggestions: Suggestion[];
  loading: boolean;
  highlighted: number | null;
  setHighlighted(index: number | null): void;
  move(delta: number): void;
}

export function useSearch(): SearchModel {
  const [text, setTextState] = useState('');
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [cache, setCache] = useState<ReadonlyMap<string, SearchResults>>(new Map());
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const term = text.trim();
  const key = term.toLowerCase();
  const suggestions = buildSuggestions(term, cache.get(key));

  const setText = useCallback((value: string) => {
    setTextState(value);
    setHighlighted(null);
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!key || cache.has(key) || buildSuggestions(term, undefined).some((s) => s.kind === 'link')) {
      setPending(null);
      return;
    }
    setPending(key);
    timer.current = window.setTimeout(() => {
      window.lurk.twitch
        .search(term)
        .catch((): SearchResults => ({ channels: [], categories: [] }))
        .then((results) => {
          setCache((previous) => new Map(previous).set(key, results));
          setPending((current) => (current === key ? null : current));
        });
    }, searchDebounceMs);
    return () => window.clearTimeout(timer.current);
  }, [key, term, cache]);

  useEffect(() => {
    if (highlighted !== null && highlighted >= suggestions.length) setHighlighted(null);
  }, [highlighted, suggestions.length]);

  return {
    text,
    setText,
    suggestions,
    loading: pending !== null && pending === key,
    highlighted,
    setHighlighted,
    move: (delta) => setHighlighted((current) => moveHighlight(current, delta, suggestions.length)),
  };
}
