// A short notice (the macOS app's Toast and ToastView): "Werbepause umgangen …", later "Clip
// gespeichert". A capsule on the floating surface with a symbol, the text and maybe one action;
// it fades in from below and goes after 6 s (7 for an error). A new one replaces the shown one.
// The caller places it; screen readers hear it through a live region that is always there.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Icon } from './index';

export interface ToastMessage {
  text: string;
  error?: boolean;
  action?: { label: string; onClick(): void };
}

/** How long a notice stays, as on macOS. */
const shownMs = 6000;
const errorShownMs = 7000;

/** The notice shown now and a way to show the next. */
export function useToast(): {
  toast: (ToastMessage & { id: number }) | null;
  show(message: ToastMessage): void;
  clear(): void;
} {
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const next = useRef(1);
  const show = useCallback((message: ToastMessage) => {
    window.clearTimeout(timer.current);
    setToast({ ...message, id: next.current++ });
    timer.current = window.setTimeout(() => setToast(null), message.error ? errorShownMs : shownMs);
  }, []);
  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, show, clear };
}

export function Toast({
  toast,
  className = '',
}: {
  toast: (ToastMessage & { id: number }) | null;
  className?: string;
}) {
  // The last notice stays in the element while it fades out.
  const [last, setLast] = useState(toast);
  if (toast && toast !== last) setLast(toast);
  const shown = toast ?? last;
  return (
    <div className={`toast-area ${className}`}>
      {/* The live region stays in the page and gets the text when a notice shows, so every screen
          reader announces it; the visible capsule fades and is not read twice. */}
      <span className="visually-hidden" role="status">
        {toast?.text ?? ''}
      </span>
      <div
        className={`toast fade-toggle${toast ? ' is-visible' : ''}`}
        // Read through the live region; only an action keeps the capsule in reach.
        aria-hidden={shown?.action ? undefined : true}
      >
        {shown ? (
          <>
            <Icon
              icon={shown.error ? TriangleAlert : CircleCheck}
              size={16}
              className={shown.error ? 'toast-icon is-error' : 'toast-icon'}
            />
            <span className="toast-text">{shown.text}</span>
            {shown.action ? (
              <button type="button" className="link" onClick={shown.action.onClick}>
                {shown.action.label}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
