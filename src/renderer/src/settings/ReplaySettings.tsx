// The settings tab "Replay & Werbung": for now the ad-break switch and the ranking by watch time it
// follows; replay and clips join in stage 2. Follows ReplayAdSettings of the macOS app (lurk-macos,
// Sources/Lurk/Views/SettingsView.swift).

import { useTranslation } from 'react-i18next';
import { formatNumber } from '@shared/format';
import { watchRanking, watchTimeParts } from '@shared/library';
import type { PlayerSettings } from '@shared/settings';
import { Avatar } from '../components';
import { useLibrary, useLive, useWatchTime } from '../useLibrary';
import { FormSection, ToggleRow } from './form';

export function ReplaySettings({ player }: { player: PlayerSettings }) {
  const { t, i18n } = useTranslation('settings');
  const language = i18n.language;
  const library = useLibrary();
  const watchTime = useWatchTime();
  const live = useLive();
  const ranking = library && watchTime ? watchRanking(library.subscriptions, watchTime) : [];
  const counted = watchTime !== null && Object.keys(watchTime).length > 0;
  const time = (seconds: number) => {
    const parts = watchTimeParts(seconds);
    if ('underAMinute' in parts) return t('replay.underAMinute');
    return parts.hours > 0
      ? t('replay.hours', {
          hours: formatNumber(parts.hours, language),
          minutes: formatNumber(parts.minutes, language),
        })
      : t('replay.minutes', { minutes: formatNumber(parts.minutes, language) });
  };
  return (
    <div className="form">
      <FormSection title={t('replay.breaksSection')}>
        <ToggleRow
          label={t('replay.adSwitch')}
          note={t('replay.adSwitchNote')}
          checked={player.adSwitch}
          onChange={(adSwitch) => void window.lurk.settings.update({ player: { adSwitch } })}
        />
      </FormSection>
      <FormSection title={t('replay.rankingSection')}>
        {ranking.every((entry) => entry.seconds === 0) ? (
          <div className="form-row">
            <p className="form-empty">{t('replay.rankingEmpty')}</p>
          </div>
        ) : (
          ranking.map((entry, index) => (
            <div className="form-row ranking-row" key={entry.subscription.id}>
              <span className="ranking-place">{t('replay.place', { place: formatNumber(index + 1, language) })}</span>
              <Avatar
                url={entry.subscription.profileImageURL}
                size={22}
                live={Boolean(live?.statuses[entry.subscription.id]?.stream)}
              />
              <span className="ranking-name">{entry.subscription.displayName}</span>
              <span className="form-value">{time(entry.seconds)}</span>
            </div>
          ))
        )}
        <div className="form-row">
          <button
            type="button"
            className="button button-destructive"
            disabled={!counted}
            onClick={() => void window.lurk.library.resetWatchTime()}
          >
            {t('replay.reset')}
          </button>
        </div>
      </FormSection>
    </div>
  );
}
