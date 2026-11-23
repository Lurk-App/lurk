// The window "Twitch-Follows übernehmen": the intro on top, below it what the import is doing –
// preparing, the code to confirm in the browser, reading, the question, done or failed. The page
// only shows phases and asks the main process to act; the sign-in itself never reaches it.
// Head, reading, done and failed follow FollowsImportView of the macOS app (lurk-macos,
// Sources/Lurk/Views/FollowsImport.swift); the code and the question are new (device code).

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, KeyRound, TriangleAlert, UserRoundCheck, UserRoundKey } from 'lucide-react';
import { isFollowsPhase, type FollowsPhase } from '@shared/follows';
import { formatNumber } from '@shared/format';
import { EmptyState, Intro, Spinner } from '../components';
import './follows.css';

export function FollowsApp() {
  const { t, i18n } = useTranslation('follows');
  const [phase, setPhase] = useState<FollowsPhase | null>(null);
  const number = (value: number) => formatNumber(value, i18n.language);

  // The window's title bar, as the main process named it (the page would otherwise say "Lurk").
  useEffect(() => {
    document.title = t('title');
  }, [t]);

  useEffect(() => {
    let alive = true;
    const off = window.lurk.follows.onPhase((next) => {
      if (isFollowsPhase(next)) setPhase(next);
    });
    void window.lurk.follows.phase().then((next) => {
      if (alive && isFollowsPhase(next)) setPhase((shown) => shown ?? next);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Return is the default action of the question and of "done", as on macOS (.defaultAction); a
  // focused button keeps its own Return.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return;
      if (phase?.kind === 'confirm') window.lurk.follows.confirm();
      if (phase?.kind === 'done') window.lurk.follows.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  let body: ReactNode = null;
  switch (phase?.kind) {
    case undefined:
    case 'preparing':
      body = <Progress text={t('preparing')} />;
      break;
    case 'code':
      body = (
        <>
          <EmptyState
            icon={KeyRound}
            title={t('code.title')}
            text={t('code.text')}
            action={{ label: t('code.open'), onClick: () => window.lurk.follows.openActivation(), prominent: true }}
            secondaryAction={{ label: t('code.copy'), onClick: () => window.lurk.follows.copyCode() }}
          >
            <p className="device-code">
              <span className="visually-hidden">{t('code.label')} </span>
              <span className="device-code-value">{phase.userCode}</span>
            </p>
          </EmptyState>
          <p className="follows-waiting" role="status">
            <Spinner size="mini" />
            {t('code.waiting', { count: phase.minutes })}
          </p>
        </>
      );
      break;
    case 'reading':
      body = <Progress text={phase.count ? t('readingCount', { number: number(phase.count) }) : t('reading')} />;
      break;
    case 'confirm':
      body = (
        <EmptyState
          icon={UserRoundCheck}
          title={t('confirm.title', { login: phase.login })}
          text={t('confirm.text', { count: phase.count, number: number(phase.count) })}
          action={{ label: t('confirm.accept'), onClick: () => window.lurk.follows.confirm(), prominent: true }}
          secondaryAction={{ label: t('confirm.cancel'), onClick: () => window.lurk.follows.close() }}
        />
      );
      break;
    case 'done':
      body = (
        <EmptyState
          icon={CircleCheck}
          title={t('done.title', { count: phase.added, number: number(phase.added) })}
          text={
            phase.total > phase.added
              ? t('done.known', { number: number(phase.total - phase.added) })
              : t('done.forgotten')
          }
          action={{ label: t('done.finish'), onClick: () => window.lurk.follows.close(), prominent: true }}
        />
      );
      break;
    case 'failed':
      body = (
        <EmptyState
          icon={TriangleAlert}
          title={t('failed.title')}
          text={t(`failed.${phase.reason}`)}
          action={{ label: t('failed.retry'), onClick: () => window.lurk.follows.retry() }}
        />
      );
      break;
  }

  return (
    <div className="follows-window">
      <header className="follows-head">
        <Intro icon={UserRoundKey} title={t('title')} text={t('intro')} />
      </header>
      {/* A new phase gets new elements: React must not hand one phase's buttons to the next. */}
      <main className="follows-body message-area" key={phase?.kind ?? 'preparing'}>
        {body}
      </main>
    </div>
  );
}

/** Preparing and reading: the large spinner over its line, announced as a status. */
function Progress({ text }: { text: string }) {
  return (
    <div className="follows-progress" role="status">
      <Spinner size="large" />
      <p>{text}</p>
    </div>
  );
}
