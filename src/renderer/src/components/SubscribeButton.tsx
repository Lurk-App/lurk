// "Abonnieren" – a local subscription, no account. Port of SubscribeButton and SubscribeStyle of the
// macOS app (lurk-macos, Sources/Lurk/Views/Components.swift): prominent in the accent while not
// subscribed, a plain bordered button with a filled heart once it is; compact, the same with the
// heart alone.

import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import type { ChannelRef } from '@shared/models';
import { useLibrary } from '../useLibrary';
import { Icon } from './index';

export function SubscribeButton({ channel, compact = false }: { channel: ChannelRef; compact?: boolean }) {
  const { t } = useTranslation('browse');
  const subscribed = useLibrary()?.subscriptions.some((entry) => entry.id === channel.id) ?? false;
  const toggle = () =>
    subscribed ? window.lurk.subscriptions.unsubscribe(channel.id) : window.lurk.subscriptions.subscribe(channel);
  const help = subscribed ? t('subscribe.end') : t('subscribe.help');
  if (compact) {
    // The reference's compact button: the same two looks, the heart alone, its state as its name.
    return (
      <button
        type="button"
        className={`button subscribe-heart${subscribed ? ' is-subscribed' : ' button-primary'}`}
        title={help}
        aria-label={subscribed ? t('subscribe.done') : t('subscribe.action')}
        onClick={toggle}
      >
        <Icon icon={Heart} size={13} />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`button subscribe-button${subscribed ? ' is-subscribed' : ' button-primary'}`}
      title={help}
      onClick={toggle}
    >
      <Icon icon={Heart} size={13} />
      {subscribed ? t('subscribe.done') : t('subscribe.action')}
    </button>
  );
}
