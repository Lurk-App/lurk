// The settings tab "Werbeblocker": the switch, the statistics, the built-in list, the own filters
// with what Lurk made of them, and the log. Follows BlockerSettings of the macOS app (lurk-macos,
// Sources/Lurk/Views/SettingsView.swift), with "Clips des Kanals zeigen" (part 7b).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Network, ShieldHalf, SquarePlay, TriangleAlert } from 'lucide-react';
import { adTimeParts, totalsAreEmpty, type BlockerEntry, type BlockerState, type FilterReport } from '@shared/blocker';
import type { FilterIssueReason } from '@shared/filterEngine';
import { formatDecimal, formatNumber } from '@shared/format';
import type { BlockerSettings as BlockerChoices } from '@shared/settings';
import { Icon, Intro } from '../components';
import { FormSection, ToggleRow } from './form';

/** The log shows the newest entries, as on macOS. */
const shownEntries = 50;
/** Long lines are shortened in the middle, so both ends stay readable (about 430 px of text). */
const lineLength = 60;

function shortened(text: string, length: number = lineLength): string {
  if (text.length <= length) return text;
  const half = Math.floor((length - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
}

export function BlockerSettings({ blocker }: { blocker: BlockerChoices }) {
  const { t, i18n } = useTranslation('settings');
  const language = i18n.language;
  const number = (value: number) => formatNumber(value, language);
  const [state, setState] = useState<BlockerState | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [report, setReport] = useState<FilterReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.lurk.blocker.state().then((first) => {
      if (!alive) return;
      setState(first);
      setText(first.user.text);
      setSaved(first.user.text);
      setReport(first.user.report);
    });
    const off = window.lurk.blocker.onChange(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const hasChanges = text !== saved;
  const apply = () => {
    const next = text;
    window.lurk.blocker.saveFilters(next).then(
      (result) => {
        setSaved(next);
        setReport(result);
        setMessage(t('blocker.saved'));
      },
      () => setMessage(t('blocker.saveFailed')),
    );
  };

  const totals = state?.totals;
  const adTime = (seconds: number) => {
    const parts = adTimeParts(seconds);
    return 'seconds' in parts
      ? t('blocker.seconds', { number: number(parts.seconds) })
      : parts.hours > 0
        ? t('blocker.hours', { hours: number(parts.hours), minutes: number(parts.minutes) })
        : t('blocker.minutes', { minutes: number(parts.minutes) });
  };

  return (
    <div className="form">
      <section className="form-section">
        <div className="form-group">
          <div className="form-row">
            <Intro icon={ShieldHalf} title={t('blocker.introTitle')} text={t('blocker.introText')} />
          </div>
        </div>
      </section>

      <FormSection title={t('blocker.section')}>
        <ToggleRow
          label={t('blocker.enabled')}
          note={t('blocker.enabledNote')}
          checked={blocker.enabled}
          onChange={(enabled) => void window.lurk.settings.update({ blocker: { enabled } })}
        />
        <ToggleRow
          label={t('blocker.adFillClips')}
          note={t('blocker.adFillClipsNote')}
          checked={blocker.enabled && blocker.adFillClips}
          disabled={!blocker.enabled}
          onChange={(adFillClips) => void window.lurk.settings.update({ blocker: { adFillClips } })}
        />
      </FormSection>

      <FormSection title={t('blocker.statsSection')}>
        <ValueRow label={t('blocker.adBreaks')} value={totals ? number(totals.adBreaks) : ''} />
        <ValueRow label={t('blocker.adTime')} value={totals ? adTime(totals.adSeconds) : ''} />
        <ValueRow label={t('blocker.adSegments')} value={totals ? number(totals.adSegments) : ''} />
        <ValueRow label={t('blocker.blockedRequests')} value={totals ? number(totals.blockedRequests) : ''} />
        <div className="form-row">
          <button
            type="button"
            className="button button-destructive"
            disabled={!state || (totalsAreEmpty(state.totals) && state.entries.length === 0)}
            onClick={() => void window.lurk.blocker.reset()}
          >
            {t('blocker.reset')}
          </button>
        </div>
      </FormSection>

      <FormSection title={t('blocker.listsSection')}>
        <ValueRow
          label={t('blocker.builtIn')}
          value={
            state ? t('blocker.rules', { count: state.builtIn.ruleCount, number: number(state.builtIn.ruleCount) }) : ''
          }
        />
        <div className="form-row column">
          <details className="form-disclosure">
            <summary>{t('blocker.showRules')}</summary>
            <pre className="filter-list">{state?.builtIn.text}</pre>
          </details>
          <p className="form-note">{t('blocker.listsNote')}</p>
        </div>
      </FormSection>

      <FormSection title={t('blocker.ownSection')}>
        <div className="form-row column">
          <textarea
            className="filter-editor"
            value={text}
            aria-label={t('blocker.ownLabel')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => {
              setText(event.target.value);
              setMessage(null);
            }}
          />
          <div className="form-buttons">
            <button type="button" className="button" disabled={!hasChanges} onClick={apply}>
              {t('blocker.apply')}
            </button>
            <button type="button" className="button" disabled={!hasChanges} onClick={() => setText(saved)}>
              {t('blocker.discard')}
            </button>
          </div>
          <p className="form-note">{t('blocker.ownNote')}</p>
          {message ? (
            <p className="form-message" role="status">
              {message}
            </p>
          ) : null}
        </div>
        {report ? (
          <>
            <ValueRow label={t('blocker.activeRules')} value={number(report.ruleCount)} />
            {report.skipped > 0 ? (
              <div className="form-row">
                <p className="form-note">
                  {t('blocker.skipped', { count: report.skipped, number: number(report.skipped) })}
                </p>
              </div>
            ) : null}
            {report.issues.map((issue) => (
              <div className="form-row filter-issue" key={`${issue.line}:${issue.text}`}>
                <Icon icon={TriangleAlert} size={14} className="filter-issue-icon" />
                <span className="log-text">
                  <span>
                    {t('blocker.issueLine', { line: number(issue.line), reason: issueReason(issue.reason, t) })}
                  </span>
                  <span className="log-rule" title={issue.text}>
                    {shortened(issue.text)}
                  </span>
                </span>
              </div>
            ))}
          </>
        ) : null}
      </FormSection>

      <FormSection title={t('blocker.logSection')}>
        {!state || state.entries.length === 0 ? (
          <div className="form-row">
            <p className="form-empty">{t('blocker.logEmpty')}</p>
          </div>
        ) : (
          state.entries.slice(0, shownEntries).map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </FormSection>
    </div>
  );
}

/** A label on the left, its value on the right (the reference's LabeledContent). */
function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="form-row form-line">
      <span>{label}</span>
      <span className="form-value">{value}</span>
    </div>
  );
}

function LogRow({ entry }: { entry: BlockerEntry }) {
  const { t, i18n } = useTranslation('settings');
  const language = i18n.language;
  const detail = entry.detail;
  let text: string;
  switch (detail.kind) {
    case 'request':
      text = t('blocker.log.request', { type: detail.type, address: detail.address });
      break;
    case 'prune':
      text = t('blocker.log.prune', {
        channel: detail.channel,
        count: detail.segments,
        number: formatNumber(detail.segments, language),
        seconds: formatDecimal(detail.seconds, language),
      });
      break;
    case 'skip':
      text = t('blocker.log.skip', {
        channel: detail.channel,
        seconds: formatNumber(Math.round(detail.seconds), language),
      });
      break;
    case 'switch':
      text = t('blocker.log.switch', { channel: detail.channel });
      break;
  }
  const rule = entry.rule ?? (detail.kind === 'switch' ? t('blocker.log.switchRule') : t('blocker.log.skipRule'));
  const time = new Date(entry.at).toLocaleTimeString(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return (
    <div className="form-row log-row">
      <Icon icon={detail.kind === 'request' ? Network : SquarePlay} size={14} className="log-icon" />
      <span className="log-text">
        <span title={text}>{shortened(text)}</span>
        <span className="log-rule" title={rule}>
          {shortened(rule)}
        </span>
      </span>
      <span className="log-time">{time}</span>
    </div>
  );
}

function issueReason(reason: FilterIssueReason, t: TFunction<'settings'>): string {
  switch (reason.kind) {
    case 'scriptlet':
      return t('blocker.issue.scriptlet', { name: reason.name });
    case 'type':
      return t('blocker.issue.type', { name: reason.name });
    case 'option':
      return t('blocker.issue.option', { name: reason.name });
    case 'regex':
      return t('blocker.issue.regex');
    case 'pattern':
      return t('blocker.issue.pattern');
    case 'tooLong':
      return t('blocker.issue.tooLong');
  }
}
