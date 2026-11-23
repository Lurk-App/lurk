import { describe, expect, it } from 'vitest';
import { normalizeLibrary } from '../src/shared/library';
import { defaultSettings } from '../src/shared/settings';
import {
  addSubscriptions,
  exportJSON,
  exportText,
  liveStreams,
  newlyLive,
  normalizeLogin,
  offlineSubscriptions,
  parseImport,
  updateFromStatuses,
  type ChannelStatus,
} from '../src/shared/subscriptions';

const ref = (id: string, login: string, displayName = login) => ({ id, login, displayName, profileImageURL: null });

function status(id: string, login: string, viewers: number | null, lastLiveAt: string | null = null): ChannelStatus {
  const channel = ref(id, login);
  return {
    ref: channel,
    stream:
      viewers === null
        ? null
        : {
            id: `s${id}`,
            title: 'T',
            viewersCount: viewers,
            startedAt: null,
            previewImageURL: null,
            game: null,
            broadcaster: channel,
          },
    lastLiveAt,
  };
}

describe('subscriptions', () => {
  it('adds each channel once, sorted by name', () => {
    const first = addSubscriptions([], [ref('2', 'zeta', 'Zeta'), ref('1', 'alpha', 'alpha')]);
    expect(first.added).toBe(2);
    expect(first.list.map((entry) => entry.login)).toEqual(['alpha', 'zeta']);
    const again = addSubscriptions(first.list, [ref('1', 'alpha'), ref('3', 'mid', 'Mid')]);
    expect(again.added).toBe(1);
    expect(again.list.map((entry) => entry.login)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('reads names, @names and twitch.tv links; rejects the rest', () => {
    expect(normalizeLogin(' @Gronkh ')).toBe('gronkh');
    expect(normalizeLogin('https://www.twitch.tv/MontanaBlack88')).toBe('montanablack88');
    expect(normalizeLogin('twitch.tv/videos/123')).toBeNull();
    expect(normalizeLogin('no spaces allowed')).toBeNull();
  });

  it('imports Lurk JSON, JSON lists and text lists', () => {
    const lurk = parseImport(
      JSON.stringify({
        app: 'Lurk',
        subscriptions: [
          { id: '12', login: 'Gronkh', displayName: 'Gronkh' },
          { id: 'yt:UCabc', login: 'UCabc', displayName: 'Tube', provider: 'youtube' },
        ],
      }),
    );
    expect(lurk.channels.map((channel) => channel.login)).toEqual(['gronkh']);
    expect(parseImport('["a_b", {"login": "Cee"}, {"name": "dee"}, 5]').logins).toEqual(['a_b', 'cee', 'dee']);
    expect(parseImport('gronkh, papaplatte;\ntwitch.tv/Trymacs\ngronkh').logins).toEqual([
      'gronkh',
      'papaplatte',
      'trymacs',
    ]);
  });

  it('exports what it can import again', () => {
    const { list } = addSubscriptions([], [ref('7', 'gronkh', 'Gronkh')], new Date('2026-11-23T10:00:00Z'));
    expect(parseImport(exportJSON(list)).channels).toEqual([ref('7', 'gronkh', 'Gronkh')]);
    expect(exportText(list)).toBe('gronkh\n');
    expect(normalizeLibrary(JSON.parse(JSON.stringify({ subscriptions: list }))).subscriptions).toEqual(list);
  });

  it('splits live and offline, and sees who went live', () => {
    const { list } = addSubscriptions([], [ref('1', 'a'), ref('2', 'b'), ref('3', 'c'), ref('4', 'd')]);
    const statuses = Object.fromEntries(
      [
        status('1', 'a', 10),
        status('2', 'b', 500),
        status('3', 'c', null, '2026-11-20T10:00:00Z'),
        status('4', 'd', null, '2026-11-22T10:00:00Z'),
      ].map((entry) => [entry.ref.id, entry]),
    );
    expect(liveStreams(list, statuses).map((stream) => stream.broadcaster.login)).toEqual(['b', 'a']);
    expect(offlineSubscriptions(list, statuses).map((entry) => entry.login)).toEqual(['d', 'c']);
    // Only a channel known to be offline before goes "live" (none at the first answer).
    const fresh = [status('1', 'a', 10), status('2', 'b', 5)];
    expect(newlyLive({}, fresh)).toEqual([]);
    expect(newlyLive({ '1': false, '2': true }, fresh).map((entry) => entry.ref.id)).toEqual(['1']);
  });

  it('takes over renamed channels', () => {
    const { list } = addSubscriptions([], [ref('1', 'old', 'Old')]);
    expect(updateFromStatuses(list, [status('1', 'old', null)])?.[0]?.displayName).toBe('old');
    expect(updateFromStatuses(list, [{ ...status('1', 'old', null), ref: ref('1', 'old', 'Old') }])).toBeNull();
  });

  it('notifies only when switched on', () => {
    expect(defaultSettings.player.liveNotifications).toBe(false);
  });
});
