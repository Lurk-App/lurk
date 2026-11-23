// Anonymous, read-only Twitch chat over IRC/WebSocket (nick justinfan…), as the macOS app's
// ChatClient: at most 250 messages, collected for 150 ms so busy chats do not slow the page down,
// deletions applied, emotes of BTTV, 7TV and FFZ added once their lists have arrived.

import { useEffect, useRef, useState } from 'react';
import { applyWordEmotes, messageFrom, parseIrc, type ChatMessage } from '@shared/chat';

export type ChatStatus = 'connecting' | 'connected';

export const chatLimit = 250;
const flushMs = 150;

export interface ChatState {
  status: ChatStatus;
  messages: ChatMessage[];
  /** Images of third-party emotes by id. */
  emoteUrls: ReadonlyMap<string, string>;
}

export function useChat(login: string, thirdPartyEmotes: boolean): ChatState {
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [emoteUrls, setEmoteUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const wordEmotes = useRef<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let pending: ChatMessage[] = [];
    let timer: number | undefined;
    let retry: number | undefined;
    let failures = 0;
    let room: string | null = null;
    wordEmotes.current = new Map();
    setMessages([]);
    setEmoteUrls(new Map());

    const flush = () => {
      timer = undefined;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      setMessages((current) => [...current, ...batch].slice(-chatLimit));
    };

    const enqueue = (message: ChatMessage) => {
      pending.push(message);
      timer ??= window.setTimeout(flush, flushMs);
    };

    const markDeleted = (matches: (message: ChatMessage) => boolean) => {
      const mark = (message: ChatMessage) =>
        !message.isSystem && matches(message) ? { ...message, isDeleted: true } : message;
      pending = pending.map(mark);
      setMessages((current) => current.map(mark));
    };

    const loadEmotes = (roomId: string) => {
      if (!thirdPartyEmotes || roomId === room) return;
      room = roomId;
      void window.lurk.chat.thirdPartyEmotes(roomId).then(
        (byName) => {
          if (closed || room !== roomId) return;
          const names = new Map(Object.entries(byName).map(([name, emote]) => [name, emote.id]));
          wordEmotes.current = names;
          setEmoteUrls(new Map(Object.values(byName).map((emote) => [emote.id, emote.url])));
          // Messages that came before the lists get their emotes afterwards.
          const apply = (message: ChatMessage) =>
            message.isSystem ? message : { ...message, segments: applyWordEmotes(names, message.segments) };
          pending = pending.map(apply);
          setMessages((current) => current.map(apply));
        },
        () => {
          room = null;
        },
      );
    };

    const connect = () => {
      setStatus('connecting');
      const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      socket = ws;
      ws.addEventListener('open', () => {
        const nick = `justinfan${10_000 + Math.floor(Math.random() * 90_000)}`;
        for (const line of [
          'CAP REQ :twitch.tv/tags twitch.tv/commands',
          'PASS SCHMOOPIIE',
          `NICK ${nick}`,
          `JOIN #${login.toLowerCase()}`,
        ]) {
          ws.send(line);
        }
      });
      ws.addEventListener('message', (event) => {
        for (const raw of String(event.data).split('\r\n')) {
          if (!raw) continue;
          const irc = parseIrc(raw);
          if (!irc) continue;
          const roomId = irc.tags['room-id'];
          if (roomId) loadEmotes(roomId);
          switch (irc.command) {
            case 'PING':
              ws.send(`PONG :${irc.trailing ?? 'tmi.twitch.tv'}`);
              break;
            case '001':
            case 'JOIN':
            case 'ROOMSTATE':
              failures = 0;
              setStatus('connected');
              break;
            case 'RECONNECT':
              ws.close();
              break;
            case 'CLEARMSG': {
              const target = irc.tags['target-msg-id'];
              if (target) markDeleted((message) => message.id === target);
              break;
            }
            case 'CLEARCHAT':
              if (irc.trailing) markDeleted((message) => message.login === irc.trailing);
              else markDeleted(() => true);
              break;
            default: {
              const message = messageFrom(irc, wordEmotes.current);
              if (message) enqueue(message);
            }
          }
        }
      });
      ws.addEventListener('close', () => {
        if (closed) return;
        setStatus('connecting');
        failures += 1;
        retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
      });
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [login, thirdPartyEmotes]);

  return { status, messages, emoteUrls };
}
