// Filters of the list pages: the bar under the page header (content type on the left, tag search
// on the right) and the sort and language pickers of the header. Port of ContentTypePicker,
// StreamSortPicker, TagSearchField, FilterBar and LanguagePicker of the macOS app (lurk-macos,
// Sources/Lurk/Views/Filters.swift and Components.swift). The tag search is a combobox with a
// listbox, written like the sidebar's search field.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, CircleX, Globe, Hash } from 'lucide-react';
import { contentTypes, streamLanguages, type ContentType, type StreamLanguage, type StreamSort } from '@shared/browse';
import { Icon, MenuButton, Segmented, SuggestionPanel } from './index';
import { SearchInput, blurGraceMs } from './SearchInput';
import './filters.css';

/** Typing settles for this long before suggestions are asked for. */
const suggestDelayMs = 250;

/** Under the page header: the content type on the left, whatever the page adds on the right. */
export function FilterBar({
  content,
  onContent,
  children,
}: {
  content: ContentType;
  onContent(content: ContentType): void;
  children?: ReactNode;
}) {
  const { t } = useTranslation('browse');
  return (
    <div className="filter-bar">
      <Segmented
        options={contentTypes}
        value={content}
        label={t('content.label')}
        help={t('content.help')}
        title={(option) => t(`content.${option}`)}
        onChange={onContent}
      />
      {children ? <div className="filter-bar-trailing">{children}</div> : null}
    </div>
  );
}

export function SortPicker<T extends StreamSort>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange(sort: T): void;
}) {
  const { t } = useTranslation('browse');
  return (
    <MenuButton
      icon={ArrowUpDown}
      label={t('sort.label')}
      help={t('sort.help')}
      options={options}
      value={value}
      title={(option) => t(`sort.${option as StreamSort}`)}
      onChange={onChange}
    />
  );
}

export function LanguagePicker({
  value,
  onChange,
}: {
  value: StreamLanguage;
  onChange(language: StreamLanguage): void;
}) {
  const { t } = useTranslation('browse');
  return (
    <MenuButton
      icon={Globe}
      label={t('language.label')}
      help={t('language.help')}
      options={streamLanguages}
      value={value}
      title={languageName(t)}
      onChange={onChange}
    />
  );
}

export function languageName(t: (key: string) => string): (language: StreamLanguage) => string {
  return (language) => t(`language.${language || 'all'}`);
}

/** A search field for one tag with suggestions; a chosen tag becomes a capsule with ×. */
export function TagSearchField({
  tag,
  onTag,
  placeholder,
  suggest,
}: {
  tag: string | null;
  onTag(tag: string | null): void;
  placeholder: string;
  suggest(query: string): Promise<string[]>;
}) {
  const { t } = useTranslation('browse');
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<{ query: string; items: string[] }>({ query: '', items: [] });
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [panelWanted, setPanelWanted] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;

  const shown = suggestions.items.slice(0, 8);
  const open = panelWanted && text.trim() !== '' && shown.length > 0;

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) {
      setSuggestions({ query: '', items: [] });
      setLoading(false);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      suggestRef.current(query).then(
        (items) => {
          // Typed on meanwhile: the answer belongs to older text.
          if (!current) return;
          setSuggestions({ query, items });
          setHighlighted(0);
          setLoading(false);
        },
        () => current && setLoading(false),
      );
    }, suggestDelayMs);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [text]);

  function choose(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    window.clearTimeout(blurTimer.current);
    onTag(trimmed);
    setText('');
    setSuggestions({ query: '', items: [] });
    setPanelWanted(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlighted((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlighted((index) => Math.max(index - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        // Only suggestions for what is typed now; otherwise the text as typed.
        const fresh = suggestions.query === text.trim() ? shown[highlighted] : undefined;
        choose(fresh ?? text);
        break;
      }
      case 'Escape':
        event.preventDefault();
        if (text) setText('');
        else input.current?.blur();
        break;
    }
  }

  if (tag !== null) {
    return (
      <span className="tag-capsule">
        <Icon icon={Hash} size={13} className="tag-capsule-icon" />
        <span className="tag-capsule-text">{tag}</span>
        <button
          type="button"
          className="search-input-clear"
          title={t('tag.remove')}
          aria-label={t('tag.removeNamed', { tag })}
          onClick={() => onTag(null)}
        >
          <Icon icon={CircleX} size={14} />
        </button>
      </span>
    );
  }

  return (
    <div className="tag-search">
      <SearchInput
        ref={input}
        icon={Hash}
        value={text}
        onChange={(value) => {
          setText(value);
          setPanelWanted(true);
        }}
        placeholder={placeholder}
        clearLabel={t('tag.clear')}
        loading={loading}
        loadingLabel={t('tag.searching')}
        inputProps={{
          role: 'combobox',
          'aria-label': t('tag.label'),
          'aria-expanded': open,
          'aria-controls': listId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': open ? `${listId}-${highlighted}` : undefined,
          onKeyDown,
          onFocus: () => {
            window.clearTimeout(blurTimer.current);
            setPanelWanted(true);
          },
          onBlur: () => {
            blurTimer.current = window.setTimeout(() => setPanelWanted(false), blurGraceMs);
          },
        }}
      />
      <SuggestionPanel open={open} listId={listId} label={t('tag.suggestions')} className="tag-panel">
        {shown.map((suggestion, index) => (
          <li
            key={suggestion}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === highlighted}
            className={`tag-option${index === highlighted ? ' is-highlighted' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlighted(index)}
            onClick={() => choose(suggestion)}
          >
            <Icon icon={Hash} size={12} />
            <span className="tag-option-text">{suggestion}</span>
          </li>
        ))}
      </SuggestionPanel>
    </div>
  );
}
