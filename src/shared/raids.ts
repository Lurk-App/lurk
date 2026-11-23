// Raids, as twitch.tv learns of them: Twitch's event channel (Hermes), topic `raid.<channel id>`.
// Port of RaidEvents from the native macOS app (lurk-macos, Sources/Lurk/RaidEvents.swift).

import type { ChannelRef } from './models';

export type RaidEvent =
  | { kind: 'update'; id: string; target: ChannelRef; viewers: number }
  | { kind: 'go'; id: string; target: ChannelRef }
  | { kind: 'cancel'; id: string };

export const hermesUrl = (clientId: string) => `wss://hermes.twitch.tv/v1?clientId=${encodeURIComponent(clientId)}`;

export function subscribeMessage(channelId: string, id: () => string, now: Date = new Date()): string {
  return JSON.stringify({
    type: 'subscribe',
    id: id(),
    timestamp: now.toISOString(),
    subscribe: { id: id(), type: 'pubsub', pubsub: { topic: `raid.${channelId}` } },
  });
}

/** Reads `raid_update_v2`, `raid_go_v2` and `raid_cancel_v2`. */
export function parseRaid(payload: string): RaidEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const body = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const type = typeof body['type'] === 'string' ? body['type'] : null;
  const raid = (typeof body['raid'] === 'object' && body['raid'] !== null ? body['raid'] : {}) as Record<
    string,
    unknown
  >;
  const id = typeof raid['id'] === 'string' ? raid['id'] : null;
  if (!type || !id) return null;
  if (type.startsWith('raid_cancel')) return { kind: 'cancel', id };
  const targetId = raid['target_id'];
  const login = raid['target_login'];
  if (typeof targetId !== 'string' || typeof login !== 'string') return null;
  const target: ChannelRef = {
    id: targetId,
    login,
    displayName: typeof raid['target_display_name'] === 'string' ? raid['target_display_name'] : login,
    profileImageURL: typeof raid['target_profile_image'] === 'string' ? raid['target_profile_image'] : null,
  };
  if (type.startsWith('raid_go')) return { kind: 'go', id, target };
  if (type.startsWith('raid_update')) {
    return { kind: 'update', id, target, viewers: typeof raid['viewer_count'] === 'number' ? raid['viewer_count'] : 0 };
  }
  return null;
}

/** Hermes envelopes: what a received frame means for the client. */
export type HermesFrame =
  | { kind: 'welcome'; keepaliveSeconds: number | null }
  | { kind: 'subscribed'; ok: boolean }
  | { kind: 'event'; event: RaidEvent }
  | { kind: 'reconnect' }
  | { kind: 'other' };

export function parseHermes(frame: string): HermesFrame {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(frame) as Record<string, unknown>;
  } catch {
    return { kind: 'other' };
  }
  const part = (key: string) =>
    typeof json[key] === 'object' && json[key] !== null ? (json[key] as Record<string, unknown>) : {};
  switch (json['type']) {
    case 'welcome': {
      const seconds = part('welcome')['keepaliveSec'];
      return { kind: 'welcome', keepaliveSeconds: typeof seconds === 'number' && seconds > 0 ? seconds : null };
    }
    case 'subscribeResponse':
      return { kind: 'subscribed', ok: part('subscribeResponse')['result'] === 'ok' };
    case 'notification': {
      const payload = part('notification')['pubsub'];
      const event = typeof payload === 'string' ? parseRaid(payload) : null;
      return event ? { kind: 'event', event } : { kind: 'other' };
    }
    case 'reconnect':
      return { kind: 'reconnect' };
    default:
      return { kind: 'other' };
  }
}
