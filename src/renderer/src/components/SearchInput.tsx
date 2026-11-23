// The search field of the app: the sidebar's search, the tag search of Entdecken and the history's
// filter (decided 2026-11-23: one shared piece). A bordered field with a leading symbol that takes
// the accent while focused, and at its end a small spinner or a button that clears it. Roles such
// as combobox and listbox stay with the caller, which passes them on to the input.

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { CircleX, type LucideIcon } from 'lucide-react';
import { Icon, Spinner } from './index';

/** Time a click on a suggestion has to land after a field loses focus. */
export const blurGraceMs = 200;

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder' | 'type'>;

export const SearchInput = forwardRef<
  HTMLInputElement,
  {
    icon: LucideIcon;
    value: string;
    onChange(value: string): void;
    placeholder: string;
    clearLabel: string;
    /** While true, a spinner stands where the clear button would. */
    loading?: boolean;
    loadingLabel?: string;
    className?: string;
    /** In a page header: as high as the header's buttons. */
    compact?: boolean;
    inputProps?: InputProps;
  }
>(function SearchInput(
  {
    icon,
    value,
    onChange,
    placeholder,
    clearLabel,
    loading = false,
    loadingLabel,
    className = '',
    compact = false,
    inputProps = {},
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const { onFocus, onBlur, ...rest } = inputProps;
  return (
    <div className={`search-input${focused ? ' is-focused' : ''}${compact ? ' is-compact' : ''} ${className}`}>
      <Icon icon={icon} size={14} className="search-input-icon" />
      <input
        ref={ref}
        type="search"
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        autoComplete="off"
        {...rest}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
      />
      {loading ? (
        <Spinner size="mini" label={loadingLabel} />
      ) : value ? (
        <button
          type="button"
          className="search-input-clear"
          title={clearLabel}
          aria-label={clearLabel}
          // Keeps the focus in the field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange('')}
        >
          <Icon icon={CircleX} size={14} />
        </button>
      ) : null}
    </div>
  );
});
