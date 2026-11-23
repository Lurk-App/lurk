// Raids of the channel on screen, from Twitch's event channel (Hermes) – the way twitch.tv learns
// of them. As in the macOS app's PlayerModel: a raid being prepared shows a banner; when it starts,
// the player follows unless the user stays or switched "Raids folgen" off (checked at that moment).

import { useEffect, useRef, useState } from 'react';
import type { ChannelRef } from '@shared/models';
import { hermesUrl, parseHermes, subscribeMessage } from '@shared/raids';
import { twitchWebClientId } from '@shared/twitchClient';

export interface PendingRaid {
  id: string;
  target: ChannelRef;
  viewers: number;
}

export function useRaids(channelId: string | null, followRaids: boolean, follow: (target: ChannelRef) => void) {
  const [pending, setPending] = useState<PendingRaid | null>(null);
  const ignored = useRef<string | null>(null);
  const settings = useRef({ followRaids, follow });
  settings.current = { followRaids, follow };

  useEffect(() => {
    if (!channelId) return;
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let failures = 0;
    const newId = () => crypto.randomUUID();

    const connect = () => {
      const ws = new WebSocket(hermesUrl(twitchWebClientId));
      socket = ws;
      ws.addEventListener('message', (message) => {
        const frame = parseHermes(String(message.data));
        switch (frame.kind) {
          case 'welcome':
            failures = 0;
            ws.send(subscribeMessage(channelId, newId));
            break;
          case 'reconnect':
            ws.close();
            break;
          case 'event': {
            const event = frame.event;
            if (event.kind === 'cancel') {
              setPending((current) => (current?.id === event.id ? null : current));
            } else if (event.kind === 'update') {
              if (settings.current.followRaids && event.id !== ignored.current) {
                setPending({ id: event.id, target: event.target, viewers: event.viewers });
              }
            } else {
              setPending(null);
              if (settings.current.followRaids && event.id !== ignored.current) settings.current.follow(event.target);
            }
            break;
          }
          default:
            break;
        }
      });
      ws.addEventListener('close', () => {
        if (closed) return;
        failures += 1;
        retry = window.setTimeout(connect, Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)));
      });
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [channelId]);

  return {
    pending,
    /** "Hierbleiben": not this raid. */
    stay: () => {
      ignored.current = pending?.id ?? null;
      setPending(null);
    },
    /** "Jetzt mitgehen". */
    goNow: () => {
      if (pending) settings.current.follow(pending.target);
      setPending(null);
    },
  };
}
