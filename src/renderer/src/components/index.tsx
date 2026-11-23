// Shared pieces of every page – the counterparts of the macOS app's Page, PageHeader,
// HeaderIconButton, SectionTitle, Avatar, LiveBadge, Pill, LoaderStatus, the segmented and menu
// pickers and ContentUnavailableView (lurk-macos, Sources/Lurk/Views/Theme.swift and
// Components.swift). Values only through the theme tokens.

import { useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, MonitorOff, TriangleAlert, type LucideIcon } from 'lucide-react';
import { formatNumber } from '@shared/format';
import type { Loader } from './useLoader';
import { useRadioGroup } from './useRadioGroup';
import './components.css';

/** Icons from Lucide, decorative unless given a label. */
export function Icon({
  icon: Glyph,
  size = 16,
  label,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  );
}

/** The activity indicator (macOS ProgressView). */
export function Spinner({ size = 'small', label }: { size?: 'mini' | 'small' | 'regular' | 'large'; label?: string }) {
  return <span className={`spinner spinner-${size}`} role={label ? 'status' : undefined} aria-label={label} />;
}

/** Every page: a scroll area on the canvas with the page edge and the gap between sections. */
export function Page({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="page" aria-label={label}>
      <div className="page-body">{children}</div>
    </div>
  );
}

/** Head of every page: title, one line of context, controls on the right. */
export function PageHeader({
  title,
  subtitle,
  detail,
  children,
}: {
  title: string;
  subtitle?: string | null;
  /** A longer text under the context line (a channel's description): 3 lines at most, selectable. */
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        {detail ? <p className="page-detail">{detail}</p> : null}
      </div>
      {children ? <div className="page-header-controls">{children}</div> : null}
    </header>
  );
}

/** Small bordered icon button for page headers (refresh and the like). */
export function HeaderIconButton({
  title,
  icon,
  busy = false,
  disabled = false,
  onClick,
}: {
  title: string;
  icon: LucideIcon;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="header-icon-button"
      title={title}
      aria-label={title}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? <Spinner size="small" /> : <Icon icon={icon} size={15} />}
    </button>
  );
}

export function SectionTitle({ title, count }: { title: string; count?: number | string }) {
  const { i18n } = useTranslation();
  return (
    <h2 className="section-title">
      {title}
      {count !== undefined ? (
        <span className="section-count">{typeof count === 'number' ? formatNumber(count, i18n.language) : count}</span>
      ) : null}
    </h2>
  );
}

/** Empty, not-yet and failure states (macOS ContentUnavailableView). */
export function EmptyState({
  icon,
  title,
  text,
  action,
  secondaryAction,
  children,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  /** `prominent`: the accent's button, for the main way on (macOS borderedProminent). */
  action?: { label: string; onClick: () => void; prominent?: boolean };
  /** A second, plain button beside it. */
  secondaryAction?: { label: string; onClick: () => void };
  /** Shown between the text and the buttons (the import window's code). */
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon icon={icon} size={40} className="empty-state-icon" />
      <h2 className="empty-state-title">{title}</h2>
      {text ? <p className="empty-state-text">{text}</p> : null}
      {children}
      {action || secondaryAction ? (
        <div className="empty-state-actions">
          {action ? (
            <button
              type="button"
              className={`button${action.prominent ? ' button-primary' : ''}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" className="button" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Round profile picture; a red ring while live. Until it loads (or if it fails), a raised circle. */
export function Avatar({ url, size = 36, live = false }: { url: string | null; size?: number; live?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`avatar${live ? ' avatar-live' : ''}`}
      style={{ width: size, height: size, ['--avatar-size' as string]: `${size}px` }}
    >
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

/** Box art of a category in 3 : 4, like the macOS app's RemoteImage with aspect 3/4. */
export function BoxArt({ url, width, large = false }: { url: string | null; width: number; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`box-art${large ? ' is-large' : ''}`} style={{ width, height: Math.round((width * 4) / 3) }}>
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

/**
 * Suggestions under a search field (decided 2026-11-23: one shared piece): a floating panel that
 * fades in while open and, faded out, leaves the accessibility tree; its listbox holds the rows.
 * Where it sits is the caller's (className).
 */
export function SuggestionPanel({
  open,
  listId,
  label,
  className,
  children,
  footer,
}: {
  open: boolean;
  listId: string;
  label: string;
  className: string;
  children: ReactNode;
  /** Below the list (the sidebar's "Suche …" while it waits). */
  footer?: ReactNode;
}) {
  return (
    <FloatingPanel className={`suggestion-popup fade-toggle ${className}${open ? ' is-visible' : ''}`}>
      <ul id={listId} role="listbox" aria-label={label}>
        {children}
      </ul>
      {footer}
    </FloatingPanel>
  );
}

/**
 * The intro block at the top of a settings tab or a small window: the topic's icon in the accent,
 * its title and one explanation (the reference's Label with .headline and .callout).
 */
export function Intro({ icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="intro">
      <Icon icon={icon} size={20} className="intro-icon" />
      <div>
        <h1 className="intro-title">{title}</h1>
        <p className="intro-text">{text}</p>
      </div>
    </div>
  );
}

/** The floating-panel look: raised, radius 12, hairline, shadow (suggestions, popovers). */
export function FloatingPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`floating-panel ${className}`}>{children}</div>;
}

/** "LIVE" on a thumbnail or beside a name. */
export function LiveBadge() {
  const { t } = useTranslation('common');
  return <span className="live-badge">{t('live')}</span>;
}

/** A dark capsule on a picture: viewers, uptime, duration. */
export function Pill({ text, icon, label }: { text: string; icon?: LucideIcon; label?: string }) {
  return (
    <span className="pill" aria-label={label} role={label ? 'img' : undefined}>
      {icon ? <Icon icon={icon} size={10} /> : null}
      <span aria-hidden={label ? true : undefined}>{text}</span>
    </span>
  );
}

/** The system's segmented picker: one choice of a few, keyboard like a radio group. */
export function Segmented<T extends string>({
  options,
  value,
  label,
  title,
  help,
  fill = false,
  onChange,
}: {
  options: readonly T[];
  value: T;
  /** The group's name for screen readers. */
  label: string;
  title(option: T): string;
  /** Tooltip of the whole control. */
  help?: string;
  /** As wide as its container (forms); otherwise as wide as its labels. */
  fill?: boolean;
  onChange(option: T): void;
}) {
  const radio = useRadioGroup(options, value, onChange);
  return (
    <div className={`segmented${fill ? ' is-fill' : ''}`} {...radio.group} aria-label={label} title={help}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          {...radio.option(option)}
          className={`segment${option === value ? ' is-selected' : ''}`}
        >
          {title(option)}
        </button>
      ))}
    </div>
  );
}

/**
 * A picker in a page header: its name, then a button with the chosen value that opens a system menu
 * (the macOS app's menu-style Picker).
 */
export function MenuButton<T extends string>({
  icon,
  label,
  help,
  options,
  value,
  title,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  help: string;
  options: readonly T[];
  value: T;
  title(option: T): string;
  onChange(option: T): void;
}) {
  async function open(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const chosen = await window.lurk.showMenu(
      options.map((option) => ({ type: 'item', id: option, label: title(option), checked: option === value })),
      { x: rect.left, y: rect.bottom + 4 },
    );
    const option = options.find((candidate) => candidate === chosen);
    if (option !== undefined && option !== value) onChange(option);
  }
  return (
    <span className="menu-picker" title={help}>
      <span className="menu-picker-label" aria-hidden="true">
        <Icon icon={icon} size={14} />
        {label}
      </span>
      <button
        type="button"
        className="menu-button"
        aria-haspopup="menu"
        aria-label={`${label}: ${title(value)}`}
        onClick={(event) => void open(event)}
      >
        {title(value)}
        <Icon icon={ChevronsUpDown} size={12} className="menu-button-chevron" />
      </button>
    </span>
  );
}

/**
 * What a list shows besides its items: a spinner while the first answer is out, a failure with
 * "Erneut versuchen" (above the list a failed refresh kept), or the empty state (the macOS app's
 * LoaderStatus).
 */
export function LoadState<T>({
  loader,
  failedTitle,
  emptyTitle,
  emptyText,
  emptyIcon = MonitorOff,
}: {
  loader: Loader<T>;
  failedTitle?: string;
  emptyTitle?: string;
  emptyText: string;
  emptyIcon?: LucideIcon;
}) {
  const { t } = useTranslation('common');
  if (loader.items.length === 0 && (loader.loading || !loader.loaded)) {
    return (
      <div className="load-state">
        <Spinner size="regular" label={t('loading')} />
      </div>
    );
  }
  if (loader.error !== null) {
    return (
      <div className={`load-state${loader.items.length ? ' is-above-list' : ''}`}>
        <EmptyState
          icon={TriangleAlert}
          title={failedTitle ?? t('loadFailed')}
          text={loader.error}
          action={{ label: t('retry'), onClick: loader.reload }}
        />
      </div>
    );
  }
  if (loader.items.length === 0) {
    return (
      <div className="load-state">
        <EmptyState icon={emptyIcon} title={emptyTitle ?? t('nothingFound')} text={emptyText} />
      </div>
    );
  }
  return null;
}
