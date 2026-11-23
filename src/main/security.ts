// Security baseline (see SECURITY.md and the risk table in the plan).
//
// - The interface runs sandboxed, with context isolation and without Node.
// - A strict Content-Security-Policy: scripts only from the app itself, no eval, no inline code.
// - The app never navigates away from itself and opens no windows on its own; web links go to the
//   system browser, and only https ones.
// - No permission (camera, microphone, location, …) is ever granted to a page.
// - The main process answers IPC only from the app's own top frame.
// - No client certificate is ever sent (Electron's default would send the first one it finds).

import { app, shell, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron';

export const appScheme = 'lurk';
export const appOrigin = `${appScheme}://app`;

/** Set by electron-vite while `npm run dev` runs: the interface then comes from Vite's server. */
export const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;

const policy = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  // Thumbnails, avatars, emotes and box art come from the services' image hosts.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'blob:', 'data:', 'https:'],
  'connect-src': ["'self'", 'https:', 'wss:'],
  'worker-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  'frame-src': ['https://www.youtube-nocookie.com'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

function serialize(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** The policy for the built app, sent with every page the lurk:// protocol serves. */
export const contentSecurityPolicy = serialize(policy);

/**
 * During `npm run dev` only: Vite's React refresh needs one inline script and a WebSocket to the
 * dev server. Never used in a built app.
 */
function devContentSecurityPolicy(origin: string): string {
  const ws = origin.replace(/^http/, 'ws');
  return serialize({
    ...policy,
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'connect-src': [...policy['connect-src'], ws],
  });
}

/** Whether a URL belongs to the app's own interface. */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Node's URL gives custom schemes the origin "null", so compare scheme and host instead.
    if (parsed.protocol === `${appScheme}:` && parsed.host === 'app') return true;
    return devServerUrl !== undefined && parsed.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/** Web links leave the app: only https, and only to the system browser. */
export function openExternal(url: string): void {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url);
  } catch {
    // Not a URL: ignore.
  }
}

/** Rules for every page in the session that serves the app. */
export function secureSession(target: Session): void {
  target.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Fullscreen for the video element is the only thing a page may ask for.
    callback(permission === 'fullscreen');
  });
  target.setPermissionCheckHandler((_webContents, permission) => permission === 'fullscreen');

  if (devServerUrl) {
    const origin = new URL(devServerUrl).origin;
    target.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [devContentSecurityPolicy(origin)] },
      });
    });
  }
}

/** Rules for every web contents the app creates, now and later. */
export function secureWebContents(): void {
  app.on('select-client-certificate', (event, _contents, _url, _list, callback) => {
    event.preventDefault();
    callback();
  });
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) {
        event.preventDefault();
        openExternal(url);
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** IPC is answered only for the app's own top frame – never for an embedded or foreign page. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return frame !== null && frame.parent === null && isAppUrl(frame.url);
}
