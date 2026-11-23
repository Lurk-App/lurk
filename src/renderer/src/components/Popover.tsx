// A small panel that opens at a button: the macOS app's `.popover` (the shield's popover in the
// player; replay's in stage 2). The floating-panel look, below the button with the right edges
// aligned, kept inside the window. It fades in and out; Esc and a click outside close it, and focus
// goes back to the button. Drawn into the document's body, so no clipping or blurred bar holds it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FloatingPanel } from './index';

/** Gap between the button and the panel, and to the window's edges. */
const gap = 8;
const focusable =
  'button:not(:disabled), input:not(:disabled), a[href], select, textarea, [tabindex]:not([tabindex="-1"])';

export function Popover({
  id,
  open,
  anchor,
  label,
  className = '',
  dark = false,
  onClose,
  children,
}: {
  /** For the button's `aria-controls`. */
  id: string;
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  /** The dialog's name for screen readers. */
  label: string;
  className?: string;
  /** Dark in every appearance (a popover of the player's stage). */
  dark?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  // Below the button, right edges aligned, inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const button = anchor.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!button || !box) return;
      const left = Math.min(Math.max(gap, button.right - box.width), window.innerWidth - box.width - gap);
      const top = Math.min(button.bottom + gap, Math.max(gap, window.innerHeight - box.height - gap));
      setPlace({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, anchor]);

  const shown = open && place !== null;

  // Focus moves in once the panel shows (a hidden one cannot take it).
  useEffect(() => {
    if (!shown) return;
    const first = panel.current?.querySelector<HTMLElement>(focusable);
    (first ?? panel.current)?.focus();
  }, [shown]);

  // Esc and a click outside close it; after Esc, focus goes back to the button.
  useEffect(() => {
    if (!open) return;
    const close = (returnFocus: boolean) => {
      onClose();
      if (returnFocus) anchor.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      // Tab past its last control (or Shift+Tab before its first) leaves it: back to the button.
      if (event.key !== 'Tab' || !panel.current?.contains(document.activeElement)) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>(focusable)];
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (document.activeElement === edge || controls.length === 0) {
        event.preventDefault();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      // A click on the button itself toggles through the button.
      if (target && (panel.current?.contains(target) || anchor.current?.contains(target))) return;
      close(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`popover fade-toggle${dark ? ' dark-scope' : ''}${shown ? ' is-visible' : ''}`}
      style={place ? { top: place.top, left: place.left } : undefined}
    >
      <FloatingPanel className={className}>{children}</FloatingPanel>
    </div>,
    document.body,
  );
}
