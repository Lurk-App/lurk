import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activationURL,
  checkValidation,
  classifyPoll,
  codeMinutes,
  collectFollows,
  followedChannelsURL,
  followsScope,
  isFollowsPhase,
  parseDeviceGrant,
  parseFollowsPage,
  rateLimitWait,
} from '../src/shared/follows';
import { lurkTwitchClientId, twitchWebClientId } from '../src/shared/twitchClient';

const grant = {
  device_code: 'SecretDeviceCode1234567890',
  user_code: 'ABCDEFGH',
  verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
  expires_in: 1800,
  interval: 5,
};

describe('starting the device code', () => {
  it('keeps a well-formed answer', () => {
    expect(parseDeviceGrant(grant)).toEqual({
      deviceCode: 'SecretDeviceCode1234567890',
      userCode: 'ABCDEFGH',
      expiresIn: 1800,
      interval: 5,
    });
  });

  it('refuses broken or hostile answers', () => {
    expect(parseDeviceGrant(null)).toBeNull();
    expect(parseDeviceGrant({ ...grant, user_code: '<b>x</b>' })).toBeNull();
    expect(parseDeviceGrant({ ...grant, user_code: 'abcdefgh' })).toBeNull();
    expect(parseDeviceGrant({ ...grant, device_code: 'short' })).toBeNull();
    expect(parseDeviceGrant({ ...grant, device_code: 'has space inside it' })).toBeNull();
    expect(parseDeviceGrant({ ...grant, expires_in: 0 })).toBeNull();
    expect(parseDeviceGrant({ ...grant, expires_in: 86_400 })).toBeNull();
    expect(parseDeviceGrant({ ...grant, interval: 1.5 })).toBeNull();
  });

  it('builds the activation address itself, with the user code and never the device code', () => {
    const url = new URL(activationURL('ABCDEFGH'));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('www.twitch.tv');
    expect(url.pathname).toBe('/activate');
    expect(url.searchParams.get('device-code')).toBe('ABCDEFGH');
    expect(activationURL('ABCDEFGH')).not.toContain('SecretDeviceCode');
  });

  it('says how many minutes the code is valid', () => {
    expect(codeMinutes(1800)).toBe(30);
    expect(codeMinutes(20)).toBe(1);
  });
});

describe('waiting for the confirmation', () => {
  it('keeps only the two tokens', () => {
    const outcome = classifyPoll(200, {
      access_token: 'abcdefghij0123456789abcdefghij',
      refresh_token: 'refresh0123456789refresh0123456789refresh01234567',
      scope: [followsScope],
      token_type: 'bearer',
      expires_in: 14_820,
    });
    expect(outcome).toEqual({
      kind: 'token',
      accessToken: 'abcdefghij0123456789abcdefghij',
      refreshToken: 'refresh0123456789refresh0123456789refresh01234567',
    });
  });

  it('refuses a token that is not one', () => {
    expect(classifyPoll(200, { access_token: 'x y' }).kind).toBe('failed');
    expect(classifyPoll(200, {}).kind).toBe('failed');
  });

  it("sorts Twitch's answers and the standard's", () => {
    expect(classifyPoll(400, { status: 400, message: 'authorization_pending' }).kind).toBe('pending');
    expect(classifyPoll(400, { error: 'authorization_pending' }).kind).toBe('pending');
    expect(classifyPoll(400, { error: 'slow_down' }).kind).toBe('slowDown');
    expect(classifyPoll(400, { status: 400, message: 'invalid device code' }).kind).toBe('expired');
    expect(classifyPoll(400, { error: 'expired_token' }).kind).toBe('expired');
    expect(classifyPoll(400, { error: 'access_denied' }).kind).toBe('denied');
    expect(classifyPoll(429, null).kind).toBe('rateLimited');
    expect(classifyPoll(500, null).kind).toBe('failed');
    expect(classifyPoll(400, { message: 'something new' }).kind).toBe('failed');
  });

  it('waits as long as Ratelimit-Reset says, within limits', () => {
    expect(rateLimitWait('1000', 990_000)).toBe(10);
    expect(rateLimitWait('2000', 1_000_000)).toBe(60);
    expect(rateLimitWait(null)).toBe(10);
    expect(rateLimitWait('soon')).toBe(10);
  });
});

describe('validate', () => {
  const ok = {
    client_id: 'lurkclient123',
    login: 'Viewer_1',
    scopes: [followsScope],
    user_id: '12345',
    expires_in: 14_000,
  };

  it('accepts only Lurk’s client with a user and the follows permission', () => {
    expect(checkValidation(ok, 'lurkclient123')).toEqual({ userId: '12345', login: 'viewer_1' });
    expect(checkValidation(ok, twitchWebClientId)).toBeNull();
    expect(checkValidation(ok, '')).toBeNull();
    expect(checkValidation({ ...ok, scopes: [] }, 'lurkclient123')).toBeNull();
    expect(checkValidation({ ...ok, user_id: null }, 'lurkclient123')).toBeNull();
    expect(checkValidation({ ...ok, login: 'not a login!' }, 'lurkclient123')).toBeNull();
  });
});

describe('reading the follows', () => {
  it('builds the page address with the user and the cursor', () => {
    const url = new URL(followedChannelsURL('12345', 'abc=='));
    expect(url.origin + url.pathname).toBe('https://api.twitch.tv/helix/channels/followed');
    expect(url.searchParams.get('user_id')).toBe('12345');
    expect(url.searchParams.get('first')).toBe('100');
    expect(url.searchParams.get('after')).toBe('abc==');
    expect(new URL(followedChannelsURL('12345', null)).searchParams.has('after')).toBe(false);
  });

  it('keeps only real channels and a sane cursor', () => {
    const page = parseFollowsPage({
      total: 4,
      data: [
        { broadcaster_id: '1', broadcaster_login: 'Alpha', broadcaster_name: 'Alpha', followed_at: 'x' },
        { broadcaster_id: 'x1', broadcaster_login: 'beta', broadcaster_name: 'Beta' },
        { broadcaster_id: '3', broadcaster_login: 'not valid', broadcaster_name: 'Gamma' },
        { broadcaster_id: '4', broadcaster_login: 'delta', broadcaster_name: 'D'.repeat(300) },
      ],
      pagination: { cursor: 'eyJiIjpudWxsfQ==' },
    });
    expect(page.channels.map((channel) => channel.login)).toEqual(['alpha', 'delta']);
    expect(page.channels[1]!.displayName).toHaveLength(100);
    expect(page.channels[0]!.profileImageURL).toBeNull();
    expect(page.cursor).toBe('eyJiIjpudWxsfQ==');
    expect(parseFollowsPage({ data: [], pagination: { cursor: 'a/b?c' } }).cursor).toBeNull();
    expect(parseFollowsPage({ data: [], pagination: { cursor: 'a'.repeat(513) } }).cursor).toBeNull();
    expect(parseFollowsPage({ data: [], pagination: {} }).cursor).toBeNull();
  });

  const channel = (id: number) => ({ id: String(id), login: `c${id}`, displayName: `C${id}`, profileImageURL: null });

  it('reads page after page and reports the count', async () => {
    const pages: Record<string, { channels: ReturnType<typeof channel>[]; cursor: string | null }> = {
      start: { channels: [channel(1), channel(2)], cursor: 'p2' },
      p2: { channels: [channel(2), channel(3)], cursor: null },
    };
    const progress: number[] = [];
    const result = await collectFollows(
      async (cursor) => pages[cursor ?? 'start']!,
      (count) => progress.push(count),
    );
    expect(result.map((entry) => entry.id)).toEqual(['1', '2', '3']);
    expect(progress).toEqual([2, 3]);
  });

  it('stops at a repeated cursor and at the limit', async () => {
    let calls = 0;
    const repeated = await collectFollows(
      async () => {
        calls += 1;
        return { channels: [channel(calls)], cursor: 'same' };
      },
      () => undefined,
    );
    expect(calls).toBe(2);
    expect(repeated).toHaveLength(2);
    let page = 0;
    const limited = await collectFollows(
      async () => {
        page += 1;
        return { channels: [channel(page * 2), channel(page * 2 + 1)], cursor: `p${page}` };
      },
      () => undefined,
      5,
    );
    expect(limited).toHaveLength(5);
  });
});

describe('the window and the client', () => {
  it('shows only well-formed phases', () => {
    expect(isFollowsPhase({ kind: 'code', userCode: 'ABCD', minutes: 30 })).toBe(true);
    expect(isFollowsPhase({ kind: 'failed', reason: 'denied' })).toBe(true);
    expect(isFollowsPhase({ kind: 'failed', reason: 'other' })).toBe(false);
    expect(isFollowsPhase({ kind: 'token' })).toBe(false);
    expect(isFollowsPhase(null)).toBe(false);
  });

  it('never acts as Twitch’s own web player', () => {
    expect(lurkTwitchClientId).not.toBe(twitchWebClientId);
    const source = readFileSync('src/main/followsImport.ts', 'utf8');
    expect(source).not.toContain('twitchWebClientId');
    expect(source).not.toContain('kimne78');
    expect(source).not.toMatch(/console\./);
  });
});
