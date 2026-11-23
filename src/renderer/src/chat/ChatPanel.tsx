// The chat beside the player. Follows ChatPanel and ChatRow of the macOS app (lurk-macos,
// Sources/Lurk/Views/PlayerView.swift). Everything from the chat is inserted as text or as an
// image with its name as alt text – never as HTML.

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Pause } from 'lucide-react';
import { chatColor, twitchEmoteUrl, type ChatMessage } from '@shared/chat';
import { Icon, Spinner } from '../components';
import { useReducedMotion, useScheme } from '../useAppearance';
import { useChat } from './useChat';
import './chat.css';

export function ChatPanel({
  login,
  thirdPartyEmotes,
  animatedEmotes,
}: {
  login: string;
  thirdPartyEmotes: boolean;
  animatedEmotes: boolean;
}) {
  const { t } = useTranslation('chat');
  const chat = useChat(login, thirdPartyEmotes);
  const list = useRef<HTMLDivElement>(null);
  // Paused while the pointer rests on the list or keyboard focus is in it (reading back). A mouse
  // click (to select text) is not keyboard focus: only the pointer pauses then.
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovering || focused;
  const scheme = useScheme();
  const reducedMotion = useReducedMotion();
  const animate = animatedEmotes && !reducedMotion;

  // Follow the newest message unless paused; when the pause ends, the list jumps back down.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && !paused) element.scrollTop = element.scrollHeight;
  }, [chat.messages, paused]);

  return (
    <aside className="chat-panel" aria-label={t('title')}>
      <header className="chat-header">
        <span className="chat-title">{t('title')}</span>
        <span className="chat-channel">#{login.toLowerCase()}</span>
        <span className="chat-status">
          {chat.status === 'connected' ? (
            <span className="chat-dot" title={t('connected')} role="img" aria-label={t('connected')} />
          ) : (
            <span title={t('connecting')}>
              <Spinner size="mini" label={t('connecting')} />
            </span>
          )}
        </span>
      </header>
      <div
        className="chat-scroll"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={(event) => setFocused(event.target.matches(':focus-visible'))}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <div ref={list} className="chat-list" role="log" aria-live="polite" aria-label={t('messages')}>
          {chat.messages.map((message) => (
            <ChatRow key={message.id} message={message} scheme={scheme} emoteUrls={chat.emoteUrls} animate={animate} />
          ))}
        </div>
        {paused ? (
          <div className="chat-paused">
            <Icon icon={Pause} size={11} />
            <span>{t(hovering ? 'pausedPointer' : 'pausedFocus')}</span>
          </div>
        ) : null}
      </div>
      <footer className="chat-footer">
        <Icon icon={Eye} size={11} />
        <span>{t('readOnly')}</span>
      </footer>
    </aside>
  );
}

const ChatRow = memo(function ChatRow({
  message,
  scheme,
  emoteUrls,
  animate,
}: {
  message: ChatMessage;
  scheme: 'light' | 'dark';
  emoteUrls: ReadonlyMap<string, string>;
  animate: boolean;
}) {
  const { t } = useTranslation('chat');
  if (message.isSystem) {
    return (
      <p className="chat-row is-system">
        {message.segments.map((segment) => (segment.kind === 'text' ? segment.text : segment.name)).join('')}
      </p>
    );
  }
  const color = chatColor(message.colorHex, message.login, scheme === 'dark');
  return (
    <p className="chat-row">
      <span className="chat-name" style={{ color }}>
        {message.author}
      </span>
      {message.isAction ? ' ' : ': '}
      {message.isDeleted ? (
        <span className="chat-deleted">{t('deleted')}</span>
      ) : (
        message.segments.map((segment, index) =>
          segment.kind === 'text' ? (
            <span key={index} style={message.isAction ? { color } : undefined}>
              {segment.text}
            </span>
          ) : (
            <Emote
              key={index}
              name={segment.name}
              url={emoteUrls.get(segment.id) ?? (segment.id.includes(':') ? null : twitchEmoteUrl(segment.id, scheme))}
              animate={animate}
            />
          ),
        )
      )}
    </p>
  );
});

/**
 * An emote as an inline image, 24 high, 7 below the baseline. Its name stands until the image has
 * loaded (and stays if it fails). Without animation, the first frame is drawn still.
 */
function Emote({ name, url, animate }: { name: string; url: string | null; animate: boolean }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(url ? 'loading' : 'failed');
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (animate || state !== 'loaded' || !image.current || !canvas.current) return;
    const source = image.current;
    const target = canvas.current;
    let cancelled = false;
    // createImageBitmap takes the first frame of an animated GIF or WebP.
    void createImageBitmap(source).then((bitmap) => {
      if (cancelled) return;
      target.width = bitmap.width;
      target.height = bitmap.height;
      target.getContext('2d')?.drawImage(bitmap, 0, 0);
      bitmap.close();
    });
    return () => {
      cancelled = true;
    };
  }, [animate, state]);

  if (!url || state === 'failed') return <>{name}</>;
  return (
    <>
      {state === 'loading' ? name : null}
      <img
        ref={image}
        className={`chat-emote${state === 'loaded' && animate ? '' : ' is-hidden'}`}
        src={url}
        alt={name}
        // Hidden while loading (the name stands) or when drawn still (the canvas carries the name).
        aria-hidden={state === 'loaded' && animate ? undefined : true}
        title={name}
        decoding="async"
        draggable={false}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
      {state === 'loaded' && !animate ? (
        <canvas ref={canvas} className="chat-emote" role="img" aria-label={name} title={name} />
      ) : null}
    </>
  );
}
