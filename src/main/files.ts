import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Maps a request path to a file inside `root`, or null if it would leave it ("../", encoded
 * separators, absolute paths). "/" means index.html.
 */
export function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // No asset has a NUL or a backslash; on Windows a backslash would be a separator.
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, '.' + path.posix.sep + (decoded === '/' ? 'index.html' : decoded));
  return file.startsWith(base + path.sep) ? file : null;
}

/** Writes a temporary file and renames it, so a crash never leaves half a file. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}
