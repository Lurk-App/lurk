// The app's own origin, lurk://app. The built interface is served from here instead of file://:
// YouTube refuses embedded players without a valid origin (error 153, see the stage 0 report),
// and a fixed origin keeps the Content-Security-Policy meaningful.

import { net, protocol, type Session } from 'electron';
import { pathToFileURL } from 'node:url';
import { resolveInside } from './files';
import { appScheme, contentSecurityPolicy } from './security';

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

export function handleAppScheme(target: Session, rendererDir: string): void {
  target.protocol.handle(appScheme, async (request) => {
    const url = new URL(request.url);
    const file = url.host === 'app' ? resolveInside(rendererDir, url.pathname) : null;
    if (!file) return new Response('Not found', { status: 404 });
    let response: Response;
    try {
      response = await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!response.ok) return new Response('Not found', { status: 404 });
    const headers = new Headers(response.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', contentSecurityPolicy);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: 200, headers });
  });
}
