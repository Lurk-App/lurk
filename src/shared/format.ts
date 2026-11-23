// Numbers in the interface language (the macOS app always used de_DE). Viewers below 10 000 in
// full, above that compact; followers always compact – like the macOS app's Fmt.

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(value);
}

/** One decimal in the interface language ("6,0"). */
export function formatDecimal(value: number, language: string): string {
  return new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

export function formatCompact(value: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatViewers(value: number, language: string): string {
  return value < 10_000 ? formatNumber(value, language) : formatCompact(value, language);
}

/** "1:23 h" since a start, like the macOS app's Fmt.uptime. */
export function formatUptime(startedAt: string | Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')} h`;
}

/** "2:03:04" or "3:04", like the macOS app's Fmt.duration. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** "vor 3 Tagen" / "3 days ago" – always in numbers ("vor 1 Tag", not "gestern"), as the macOS app's
 * RelativeDateTimeFormatter writes it. */
export function formatRelative(date: string | Date, language: string, now: Date = new Date()): string {
  const seconds = (new Date(date).getTime() - now.getTime()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds), 'second');
}
