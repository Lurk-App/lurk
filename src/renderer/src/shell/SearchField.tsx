// The search field at the top of the sidebar, with suggestions while typing.
// Follows SidebarSearchField, SuggestionPanel and SuggestionRow of the macOS app
// (lurk-macos, Sources/Lurk/Views/Search.swift), written as a combobox with a listbox.

import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, CornerDownLeft, Heart, Link, Play, Search } from 'lucide-react';
import { formatCompact, formatViewers } from '@shared/format';
import type { Suggestion } from '@shared/search';
import { Avatar, BoxArt, Icon, Spinner, SuggestionPanel } from '../components';
import { SearchInput, blurGraceMs } from '../components/SearchInput';
import type { SearchModel } from './useSearch';

export interface SearchFieldHandle {
  focus(): void;
}

export const SearchField = forwardRef<
  SearchFieldHandle,
  { search: SearchModel; onActivate(suggestion: Suggestion): void }
>(function SearchField({ search, onActivate }, ref) {
  const { t } = useTranslation('shell');
  const input = useRef<HTMLInputElement>(null);
  // The field's look follows focus at once (SearchInput); the panel stays 200 ms longer so a click
  // on a row lands.
  const [panelWanted, setPanelWanted] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const open = panelWanted && search.text.trim() !== '';
  const listId = 'search-suggestions';

  function activate(suggestion: Suggestion) {
    window.clearTimeout(blurTimer.current);
    setPanelWanted(false);
    onActivate(suggestion);
    search.setText(suggestion.kind === 'all' ? search.text : '');
    input.current?.blur();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        search.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        search.move(-1);
        break;
      case 'Enter': {
        event.preventDefault();
        const chosen =
          search.highlighted !== null
            ? search.suggestions[search.highlighted]
            : (search.suggestions.find((s) => s.kind === 'link') ?? search.suggestions.find((s) => s.kind === 'all'));
        if (chosen) activate(chosen);
        break;
      }
      case 'Escape':
        event.preventDefault();
        if (search.text) search.setText('');
        else input.current?.blur();
        break;
    }
  }

  return (
    <div className="search">
      <SearchInput
        ref={input}
        icon={Search}
        value={search.text}
        onChange={(value) => {
          search.setText(value);
          setPanelWanted(true);
        }}
        placeholder={t('search.placeholder')}
        clearLabel={t('search.clear')}
        loading={search.loading}
        loadingLabel={t('search.searching')}
        inputProps={{
          role: 'combobox',
          'aria-label': t('search.label'),
          'aria-expanded': open,
          'aria-controls': listId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': open && search.highlighted !== null ? `suggestion-${search.highlighted}` : undefined,
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
      <SuggestionPanel
        open={open}
        listId={listId}
        label={t('search.suggestions')}
        className="suggestion-panel"
        footer={
          open && search.loading && search.suggestions.length <= 1 ? (
            <div className="suggestion-loading">
              <Spinner size="small" />
              <span>{t('search.searching')}</span>
            </div>
          ) : null
        }
      >
        {search.suggestions.map((suggestion, index) => (
          <SuggestionRow
            key={suggestion.id}
            index={index}
            suggestion={suggestion}
            highlighted={search.highlighted === index}
            onHover={() => search.setHighlighted(index)}
            onChoose={() => activate(suggestion)}
          />
        ))}
      </SuggestionPanel>
    </div>
  );
});

function SuggestionRow({
  suggestion,
  index,
  highlighted,
  onHover,
  onChoose,
}: {
  suggestion: Suggestion;
  index: number;
  highlighted: boolean;
  onHover(): void;
  onChoose(): void;
}) {
  const { t, i18n } = useTranslation('shell');
  const language = i18n.language;
  let leading;
  let title: string;
  let subtitle: string;
  let live = false;
  let trailing = ChevronRight;
  let subscribed = false;

  switch (suggestion.kind) {
    case 'channel': {
      const { channel } = suggestion;
      live = channel.stream !== null;
      subscribed = suggestion.subscribed;
      leading = <Avatar url={channel.ref.profileImageURL} size={28} live={live} />;
      title = channel.ref.displayName;
      subtitle = channel.stream
        ? [
            t('search.live'),
            channel.stream.viewersCount > 0 ? formatViewers(channel.stream.viewersCount, language) : null,
            channel.stream.game?.displayName,
          ]
            .filter(Boolean)
            .join(' · ')
        : channel.followers !== null
          ? t('search.followers', { value: formatCompact(channel.followers, language) })
          : t('search.offline');
      if (live) trailing = Play;
      break;
    }
    case 'category':
      leading = (
        <span className="suggestion-leading">
          <BoxArt url={suggestion.game.boxArtURL} width={21} />
        </span>
      );
      title = suggestion.game.displayName;
      subtitle = [
        t('search.category'),
        suggestion.game.viewersCount !== null
          ? t('search.viewers', { value: formatCompact(suggestion.game.viewersCount, language) })
          : null,
      ]
        .filter(Boolean)
        .join(' · ');
      break;
    case 'link':
      leading = <SymbolCircle icon={Link} />;
      title =
        suggestion.link.kind === 'channel'
          ? t('search.linkChannel', { login: suggestion.link.login })
          : suggestion.link.kind === 'vod'
            ? t('search.linkVod', { id: suggestion.link.id })
            : t('search.linkClip');
      subtitle = t('search.linkSubtitle');
      break;
    case 'all':
      leading = <SymbolCircle icon={Search} />;
      title = t('search.all', { term: suggestion.term });
      subtitle = t('search.allSubtitle');
      trailing = CornerDownLeft;
      break;
  }

  return (
    <li
      id={`suggestion-${index}`}
      role="option"
      aria-selected={highlighted}
      className={`suggestion${highlighted ? ' is-highlighted' : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onChoose}
    >
      {leading}
      <span className="suggestion-text">
        <span className="suggestion-title">
          <span className="suggestion-name">{title}</span>
          {subscribed ? (
            <Icon icon={Heart} size={10} className="suggestion-heart" label={t('search.subscribed')} />
          ) : null}
        </span>
        <span className={`suggestion-subtitle${live ? ' is-live' : ''}`}>{subtitle}</span>
      </span>
      <Icon icon={trailing} size={12} className="suggestion-trailing" />
    </li>
  );
}

function SymbolCircle({ icon }: { icon: typeof Link }) {
  return (
    <span className="suggestion-symbol">
      <Icon icon={icon} size={13} />
    </span>
  );
}
