// How tiles and rows open pages: a component outside the window's provider must not fail silently.

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouteContext, useOpenRoute } from '../src/renderer/src/components/navigation';

function Row() {
  useOpenRoute()({ kind: 'channel', login: 'lurk' });
  return null;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('OpenRouteContext', () => {
  it('throws in development when a component outside the provider opens something', () => {
    vi.stubEnv('DEV', true);
    expect(() => renderToString(createElement(Row))).toThrow(/OpenRouteContext is missing/);
  });

  it('logs in a build instead of failing the window', () => {
    vi.stubEnv('DEV', false);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderToString(createElement(Row))).not.toThrow();
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/OpenRouteContext is missing/));
  });

  it('opens through the provider', () => {
    const opened: unknown[] = [];
    renderToString(
      createElement(OpenRouteContext.Provider, { value: (route) => opened.push(route) }, createElement(Row)),
    );
    expect(opened).toEqual([{ kind: 'channel', login: 'lurk' }]);
  });
});
