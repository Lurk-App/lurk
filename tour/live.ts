// Live channels for the tour, chosen before the steps. Twitch's answers differ by region and moment
// (on GitHub's machines the search sometimes lists a big live channel as offline); the steps are
// about Lurk, not about Twitch's search.

import { expect, type Page } from '@playwright/test';
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
