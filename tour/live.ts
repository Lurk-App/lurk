// Live channels for the tour, chosen before the steps, and the ways a person asks Twitch again.
// Twitch's answers differ by region and moment (on GitHub's machines the search sometimes lists a big
// live channel as offline, and a channel, a list or a video now and then answers "service error" or
// times out); the steps are about Lurk, not about Twitch. Each helper still fails when Lurk itself
// shows nothing, the wrong thing, or no way to ask again.

import { expect, type Locator, type Page } from '@playwright/test';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deCommon from '../locales/de/common.json' with { type: 'json' };
import dePlayer from '../locales/de/player.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enCommon from '../locales/en/common.json' with { type: 'json' };
import enPlayer from '../locales/en/player.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };
import type { BrowseStream } from '../src/shared/browse';

const german = async (page: Page) => (await page.evaluate(() => document.documentElement.lang)) === 'de';

/** The page in front; covered pages stay mounted, hidden and inert. */
export const front = (page: Page): Locator => page.locator('.page-layer:not(.is-covered)');

/**
 * A setup call through Lurk's bridge, asked again when Twitch fails it ("service error", Lurk's 10 s
 * timeout; CI 2026-11-24): up to three tries, `pause` apart. The last error is thrown.
 */
export async function askAgain<T>(call: () => Promise<T>, tries = 3, pause = 5_000): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await call();
    } catch (error) {
      last = error;
      if (attempt < tries) await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
  throw last;
}

/** The most watched English live streams (Entdecken's list), asked again when Twitch fails it. */
export function liveStreams(page: Page): Promise<BrowseStream[]> {
  return askAgain(() => page.evaluate(() => window.lurk.browse.streams('all', 'EN', 'VIEWER_COUNT', null)));
}

/**
 * The most watched English streams that Twitch's search lists as live, most watched first. A search
 * that Twitch did not answer, or answered without any channel, is asked once more; a channel the
 * search lists as offline is Twitch's answer and is passed over.
 */
export async function searchableLiveStreams(page: Page, count = 1): Promise<BrowseStream[]> {
  const top = (await liveStreams(page)).slice(0, 12);
  const chosen = new Set<BrowseStream>();
  const unanswered: BrowseStream[] = [];
  const ask = async (stream: BrowseStream) => {
    const login = stream.broadcaster.login;
    const results = await page.evaluate((term) => window.lurk.twitch.search(term), login).catch(() => null);
    if (results?.channels.some((channel) => channel.ref.login === login && channel.stream)) chosen.add(stream);
    return results !== null && results.channels.length > 0;
  };
  for (const stream of top) {
    if (chosen.size === count) break;
    if (!(await ask(stream))) unanswered.push(stream);
  }
  if (chosen.size < count && unanswered.length > 0) {
    await page.waitForTimeout(10_000);
    for (const stream of unanswered.slice(0, 4)) {
      if (chosen.size === count) break;
      await ask(stream);
    }
  }
  expect(chosen.size, "live streams that Twitch's search lists as live").toBe(count);
  return top.filter((stream) => chosen.has(stream));
}

/**
 * Waits until `content` shows on the front page. When Twitch fails the page's request, Lurk shows its
 * failure view with "Erneut versuchen"; the tour presses it, as a person would – up to three times.
 * The failure may stay until Twitch answers again, or give way to a spinner meanwhile.
 */
export async function shown(page: Page, content: Locator, timeout = 20_000): Promise<void> {
  const common = (await german(page)) ? deCommon : enCommon;
  const retry = front(page).getByRole('button', { name: common.retry, exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(content.or(retry).first()).toBeVisible({ timeout });
    if (await content.first().isVisible()) return;
    await retry.click();
    const answered = await content
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (answered) return;
  }
  await expect(content.first()).toBeVisible({ timeout });
}

/** Waits for the channel page in front: its header, asked again when Twitch fails the channel. */
export async function channelShown(page: Page): Promise<void> {
  await shown(page, front(page).locator('.art-head'));
}

/**
 * Plays a live channel from the sidebar search, until the picture runs. Twitch's search now and then
 * answers without channels (CI, 2026-11-24), and Lurk keeps an answer for its term; the tour then
 * types the channel's twitch.tv link and plays it from the channel page, as a person would.
 */
export async function playFromSearch(page: Page, login: string): Promise<void> {
  const de = await german(page);
  const shell = de ? deShell : enShell;
  const browse = de ? deBrowse : enBrowse;
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill(login);
  // The channel's own suggestion, not the first live one: the term can match other live channels
  // too, and one of three viewers once came first (2026-11-26). Its name is the login apart from
  // case; a display name in another script finds no row here and goes the link's way.
  const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const live = page
    .getByRole('option')
    .filter({ has: page.locator('.suggestion-name', { hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') }) })
    .filter({ has: page.locator('.suggestion-subtitle.is-live') })
    .first();
  const listed = await live
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (listed) {
    await live.click();
  } else {
    await search.fill(`twitch.tv/${login}`);
    await page.getByRole('option', { name: shell.search.linkChannel.replace('{{login}}', login) }).click();
    await channelShown(page);
    await front(page).getByRole('button', { name: browse.channel.watchNow, exact: true }).click();
  }
  await playing(page, 2);
}

/**
 * Waits until the player's picture is past `seconds`. When Twitch answers the player with "service
 * error" or "service timeout" (CI, 2026-11-24), the player's "Erneut versuchen" asks again, as a
 * person would – up to three times.
 */
export async function playing(page: Page, seconds: number): Promise<void> {
  const player = (await german(page)) ? dePlayer : enPlayer;
  const retry = page
    .getByRole('region', { name: player.player })
    .getByRole('button', { name: player.retry, exact: true });
  let retries = 0;
  await expect
    .poll(
      async () => {
        if (retries < 3 && (await retry.isVisible())) {
          retries += 1;
          await retry.click();
          // The failure stays on screen until Twitch answers again.
          await retry.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
        }
        return page.evaluate(
          () => document.querySelector<HTMLVideoElement>('video.stage-video:not(.stage-clip)')?.currentTime ?? 0,
        );
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(seconds);
}
