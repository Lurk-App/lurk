// The settings window: tabs on top, one grouped form per tab. Follows SettingsView and
// AppearanceSettings of the macOS app (lurk-macos, Sources/Lurk/Views/SettingsView.swift and
// Appearance.swift). "Anpassen", "Wiedergabe", "Replay & Werbung" (its ad part), "Werbeblocker" and
// "Datenschutz" exist; "Daten" arrives with its part.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Hand, Palette, RotateCcw, ShieldCheck, ShieldHalf, SquarePlay } from 'lucide-react';
import type { SettingsTab } from '@shared/ipc';
import type { PlayerSettings, PrivacySettings as PrivacyChoices, Settings } from '@shared/settings';
import {
  accentPresetColors,
  accentPresets,
  appearanceModes,
  backgroundTones,
  isAccentPreset,
  resolveAccent,
  tonePalettes,
  type Appearance,
  type BackgroundTone,
} from '@shared/theme';
import { Icon, Intro, Segmented } from '../components';
import { BlockerSettings } from './BlockerSettings';
import { FormSection, ToggleRow } from './form';
import { ReplaySettings } from './ReplaySettings';
import { useRadioGroup } from '../components/useRadioGroup';
import { useLibrary } from '../useLibrary';
import './settings.css';

const lastTabKey = 'lurk.settingsTab';

export function lastSettingsTab(): string | null {
  try {
    return window.localStorage.getItem(lastTabKey);
  } catch {
    return null;
  }
}

const tabs: { id: SettingsTab; icon: typeof Palette }[] = [
  { id: 'appearance', icon: Palette },
  { id: 'playback', icon: SquarePlay },
  // The reference's gobackward.
  { id: 'replay', icon: RotateCcw },
  { id: 'blocker', icon: ShieldHalf },
  // The reference's hand.raised; its shield is the intro's.
  { id: 'privacy', icon: Hand },
];

export function SettingsApp({ initialSettings, initialTab }: { initialSettings: Settings; initialTab: SettingsTab }) {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  useEffect(() => window.lurk.onSettingsTab(setTab), []);
  // Remembered for the next "Einstellungen …" (a convenience of this computer only).
  useEffect(() => {
    try {
      window.localStorage.setItem(lastTabKey, tab);
    } catch {
      // Not stored: the next window opens on "Wiedergabe".
    }
  }, [tab]);
  const tabButtons = useRef(new Map<SettingsTab, HTMLButtonElement>());
  // The tab list is one Tab stop; the arrow keys move between the tabs (and show them).
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = tabs.findIndex((entry) => entry.id === tab);
    const next = tabs[(index + step + tabs.length) % tabs.length]!.id;
    setTab(next);
    tabButtons.current.get(next)?.focus();
  }
  // Like the macOS settings window: its title is the name of the tab.
  useEffect(() => {
    document.title = t(`tabs.${tab}`);
  }, [tab, t]);

  useEffect(() => window.lurk.settings.onChange(setSettings), []);

  return (
    <div className="settings-window">
      <div className="settings-tabs" role="tablist" aria-label={t('tabs.label')} onKeyDown={onTabKey}>
        {tabs.map(({ id, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            // Only the shown tab's panel is in the page.
            aria-controls={tab === id ? `panel-${id}` : undefined}
            tabIndex={tab === id ? 0 : -1}
            ref={(element) => {
              if (element) tabButtons.current.set(id, element);
              else tabButtons.current.delete(id);
            }}
            className={`settings-tab${tab === id ? ' is-selected' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon icon={icon} size={20} />
            <span>{t(`tabs.${id}`)}</span>
          </button>
        ))}
      </div>
      <div className="settings-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'appearance' ? <AppearanceSettings appearance={settings.appearance} /> : null}
        {tab === 'playback' ? <PlaybackSettings player={settings.player} /> : null}
        {tab === 'replay' ? <ReplaySettings player={settings.player} /> : null}
        {tab === 'blocker' ? <BlockerSettings blocker={settings.blocker} /> : null}
        {tab === 'privacy' ? <PrivacySettings privacy={settings.privacy} /> : null}
      </div>
    </div>
  );
}

function update(appearance: Partial<Appearance>) {
  void window.lurk.settings.update({ appearance });
}

function AppearanceSettings({ appearance }: { appearance: Appearance }) {
  const { t } = useTranslation('settings');
  const colorId = useId();
  const customHex = isAccentPreset(appearance.accent)
    ? accentPresetColors[appearance.accent].dark
    : resolveAccent(appearance.accent).dark;
  const accents = useRadioGroup(accentPresets, isAccentPreset(appearance.accent) ? appearance.accent : null, (accent) =>
    update({ accent }),
  );
  const tones = useRadioGroup(backgroundTones, appearance.tone, (tone) => update({ tone }));

  return (
    <div className="form">
      <section className="form-section">
        <div className="form-group">
          <div className="form-row">
            <Intro icon={Palette} title={t('appearance.introTitle')} text={t('appearance.introText')} />
          </div>
        </div>
      </section>

      <FormSection title={t('appearance.modeSection')}>
        <div className="form-row column">
          <Segmented
            options={appearanceModes}
            value={appearance.mode}
            label={t('appearance.modeSection')}
            title={(mode) => t(`appearance.mode.${mode}`)}
            fill
            onChange={(mode) => update({ mode })}
          />
          <p className="form-note">{t('appearance.modeNote')}</p>
        </div>
      </FormSection>

      <FormSection title={t('appearance.accentSection')}>
        <div className="form-row">
          <div className="swatches" {...accents.group} aria-label={t('appearance.accentSection')}>
            {accentPresets.map((preset) => {
              const selected = appearance.accent === preset;
              const label = t(`appearance.accent.${preset}`);
              return (
                <button
                  key={preset}
                  type="button"
                  {...accents.option(preset)}
                  aria-label={label}
                  title={label}
                  className={`swatch${selected ? ' is-selected' : ''}`}
                  style={{ ['--swatch' as string]: `var(--swatch-${preset})` }}
                >
                  {selected ? <Icon icon={Check} size={11} /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="form-row column">
          <div className="form-line">
            <label htmlFor={colorId}>{t('appearance.customAccent')}</label>
            <input
              id={colorId}
              type="color"
              className="color-input"
              value={customHex.toLowerCase()}
              onChange={(event) => {
                // A click on a preset changes the field too – that is not a choice of its own.
                if (event.target.value.toUpperCase() !== customHex)
                  update({ accent: event.target.value.toUpperCase() as `#${string}` });
              }}
            />
          </div>
          <p className="form-note">{t('appearance.accentNote')}</p>
        </div>
      </FormSection>

      <FormSection title={t('appearance.toneSection')}>
        <div className="form-row">
          <div className="tones" {...tones.group} aria-label={t('appearance.toneSection')}>
            {backgroundTones.map((tone) => (
              <ToneSwatch key={tone} tone={tone} selected={appearance.tone === tone} radio={tones.option(tone)} />
            ))}
          </div>
        </div>
      </FormSection>

      <section className="form-section">
        <div className="form-group">
          <div className="form-row">
            <button
              type="button"
              className="button button-destructive"
              onClick={() => void window.lurk.settings.resetAppearance()}
            >
              {t('appearance.reset')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** "Wiedergabe": the chat and raid switches of the macOS app's playback settings. */
function PlaybackSettings({ player }: { player: PlayerSettings }) {
  const { t } = useTranslation('settings');
  const set = (patch: Partial<PlayerSettings>) => void window.lurk.settings.update({ player: patch });
  return (
    <div className="form">
      <FormSection title={t('playback.browseSection')}>
        <ToggleRow
          label={t('playback.hoverPreview')}
          note={t('playback.hoverPreviewNote')}
          checked={player.hoverPreview}
          onChange={(hoverPreview) => set({ hoverPreview })}
        />
      </FormSection>
      <FormSection title={t('playback.raidsSection')}>
        <ToggleRow
          label={t('playback.followRaids')}
          note={t('playback.followRaidsNote')}
          checked={player.followRaids}
          onChange={(followRaids) => set({ followRaids })}
        />
      </FormSection>
      <FormSection title={t('playback.chatSection')}>
        <ToggleRow
          label={t('playback.showChat')}
          checked={player.showChat}
          onChange={(showChat) => set({ showChat })}
        />
        <ToggleRow
          label={t('playback.thirdPartyEmotes')}
          note={t('playback.thirdPartyEmotesNote')}
          checked={player.thirdPartyEmotes}
          onChange={(thirdPartyEmotes) => set({ thirdPartyEmotes })}
        />
        <ToggleRow
          label={t('playback.animatedEmotes')}
          note={t('playback.animatedEmotesNote')}
          checked={player.animatedEmotes}
          onChange={(animatedEmotes) => set({ animatedEmotes })}
        />
      </FormSection>
      <FormSection title={t('playback.notificationsSection')}>
        <ToggleRow
          label={t('playback.liveNotifications')}
          note={t('playback.liveNotificationsNote')}
          checked={player.liveNotifications}
          onChange={(liveNotifications) => set({ liveNotifications })}
        />
      </FormSection>
    </div>
  );
}

/** "Datenschutz": what Lurk keeps about watching, and deleting it (the macOS app's "Speichern" and
 * "Löschen"; proxy, search history and taste profile arrive with their parts). */
function PrivacySettings({ privacy }: { privacy: PrivacyChoices }) {
  const { t } = useTranslation('settings');
  const library = useLibrary();
  const set = (patch: Partial<PrivacyChoices>) => void window.lurk.settings.update({ privacy: patch });
  return (
    <div className="form">
      <section className="form-section">
        <div className="form-group">
          <div className="form-row">
            <Intro icon={ShieldCheck} title={t('privacy.introTitle')} text={t('privacy.introText')} />
          </div>
        </div>
      </section>
      <FormSection title={t('privacy.saveSection')}>
        <ToggleRow
          label={t('privacy.saveHistory')}
          checked={privacy.saveHistory}
          onChange={(saveHistory) => set({ saveHistory })}
        />
        <ToggleRow
          label={t('privacy.rememberPosition')}
          checked={privacy.rememberPosition}
          onChange={(rememberPosition) => set({ rememberPosition })}
        />
      </FormSection>
      <FormSection title={t('privacy.deleteSection')}>
        <div className="form-row">
          <button
            type="button"
            className="button button-destructive"
            disabled={!library?.history.length}
            onClick={() => void window.lurk.library.clearHistory()}
          >
            {t('privacy.clearHistory')}
          </button>
        </div>
        <div className="form-row">
          <button
            type="button"
            className="button button-destructive"
            disabled={!library || Object.keys(library.progress).length === 0}
            onClick={() => window.lurk.library.clearProgress()}
          >
            {t('privacy.clearProgress')}
          </button>
        </div>
      </FormSection>
    </div>
  );
}

/** Preview of a tone: left half light, right half dark – canvas with a surface block. */
function ToneSwatch({
  tone,
  selected,
  radio,
}: {
  tone: BackgroundTone;
  selected: boolean;
  radio: ReturnType<ReturnType<typeof useRadioGroup<BackgroundTone>>['option']>;
}) {
  const { t } = useTranslation('settings');
  const palette = tonePalettes[tone];
  const name = t(`appearance.tone.${tone}`);
  return (
    <button
      type="button"
      {...radio}
      aria-label={t('appearance.toneLabel', { name })}
      title={name}
      className={`tone${selected ? ' is-selected' : ''}`}
    >
      <span className="tone-preview">
        {(['light', 'dark'] as const).map((scheme) => (
          <span key={scheme} className="tone-half" style={{ background: palette.canvas[scheme] }}>
            <span className="tone-block" style={{ background: palette.surface[scheme] }} />
          </span>
        ))}
      </span>
      <span className="tone-name">{name}</span>
    </button>
  );
}
