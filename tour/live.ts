// Live channels for the tour, chosen before the steps. Twitch's answers differ by region and moment
// (on GitHub's machines the search sometimes lists a big live channel as offline); the steps are
// about Lurk, not about Twitch's search.

import { expect, type Page } from '@playwright/test';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };
import type { BrowseStream } from '../src/shared/browse';

/** The most watched English streams that Twitch's search lists as live, most watched first. */
export async function searchableLiveStreams(page: Page, count = 1): Promise<BrowseStream[]> {
  const top = await page.evaluate(() => window.lurk.browse.streams('all', 'EN', 'VIEWER_COUNT', null));
  const chosen: BrowseStream[] = [];
  for (const stream of top.slice(0, 12)) {
    const login = stream.broadcaster.login;
    const results = await page.evaluate((term) => window.lurk.twitch.search(term), login).catch(() => null);
    if (results?.channels.some((channel) => channel.ref.login === login && channel.stream)) chosen.push(stream);
    if (chosen.length === count) break;
  }
  expect(chosen.length, "live streams that Twitch's search lists as live").toBe(count);
  return chosen;
}

/**
 * Plays a live channel from the sidebar search. Twitch's search now and then answers without
 * channels (CI, 2026-11-24), and Lurk keeps an answer for its term; the tour then types the
 * channel's twitch.tv link and plays it from the channel page, as a person would.
 */
export async function playFromSearch(page: Page, login: string): Promise<void> {
  const de = (await page.evaluate(() => document.documentElement.lang)) === 'de';
  const shell = de ? deShell : enShell;
  const browse = de ? deBrowse : enBrowse;
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill(login);
  const live = page.getByRole('option').filter({ hasText: shell.search.live }).first();
  if (
    await live.waitFor({ timeout: 20_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await live.click();
    return;
  }
  await search.fill(`twitch.tv/${login}`);
  await page.getByRole('option', { name: shell.search.linkChannel.replace('{{login}}', login) }).click();
  const front = page.locator('.page-layer:not(.is-covered)');
  await front.getByRole('button', { name: browse.channel.watchNow }).click({ timeout: 30_000 });
}
