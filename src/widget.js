// -----------------------------------------------------------------------------
// Dashboard widget `tv_guide` (manifest `widgets`).
//
// Shows, for a list of channels, the programme on air NOW or TONIGHT (setting
// `moment`), as a `card-list`: tapping a row opens the core's detail panel with
// the programme description.
//
// The core renders the content (theme, dark mode, layout): we only return the
// declarative components, see the "Dashboard widgets" section of the SDK
// README.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { findChannel } from './channels.js';
import { findSchedule, formatTime, getGuide } from './guide.js';

export const WIDGET_TV_GUIDE = 'tv_guide';

export const MOMENT = { NOW: 'now', TONIGHT: 'tonight' };

// `list` display of a card-list: 1 to 8 items.
export const MAX_ITEMS = 8;
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 2000;

// Content lifetime (the core pulls again when it expires).
const TTL_MIN = 60;
const TTL_MAX = 3600;
const TTL_TONIGHT = 1800;

const TEXTS = {
  noProgramme: { en: 'No programme', fr: 'Aucun programme' },
  noChannel: {
    en: 'No channel selected: pick channels in the widget or integration settings.',
    fr: "Aucune chaîne choisie : cochez des chaînes dans le widget ou la configuration de l'intégration.",
  },
  more: {
    en: (n) => `+${n} more channel(s), see the devices.`,
    fr: (n) => `+${n} autre(s) chaîne(s), voir les appareils.`,
  },
  left: { en: (m) => `${m} min left`, fr: (m) => `encore ${m} min` },
};

const lang = (language) => (language === 'fr' ? 'fr' : 'en');
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Channels shown by a widget instance: its own `channels` setting, or the
 * channels of the integration configuration when the setting is empty.
 */
export function widgetChannels(settings, config) {
  const own = Array.isArray(settings?.channels) ? settings.channels : [];
  const ids = own.length > 0 ? own : config.channels;
  return [...new Set(ids)].map(findChannel).filter(Boolean);
}

function buildItem(channel, programme, moment, language, now) {
  if (!programme) {
    return { title: TEXTS.noProgramme[language], subtitle: channel.name };
  }
  const item = {
    title: truncate(programme.title, MAX_TITLE),
    subtitle: `${channel.name} · ${formatTime(programme.start)} - ${formatTime(programme.stop)}`,
  };
  if (moment === MOMENT.NOW) {
    const minutesLeft = Math.max(1, Math.ceil((programme.stop - now) / 60_000));
    item.badge = { text: TEXTS.left[language](minutesLeft), color: WIDGET_COLORS.PRIMARY };
  } else {
    item.badge = { text: formatTime(programme.start), color: WIDGET_COLORS.INFO };
  }
  const details = [programme.subTitle, programme.category, programme.description].filter(Boolean);
  if (details.length > 0) {
    item.description = truncate(details.join('\n'), MAX_DESCRIPTION);
  }
  return item;
}

/**
 * Build the widget content.
 * @param {Map} guide result of getGuide()
 * @param {{ settings?: object, language?: string, config: object, now?: Date }} options
 */
export function buildWidgetContent(guide, { settings = {}, language, config, now = new Date() }) {
  const l = lang(language);
  const moment = settings.moment === MOMENT.TONIGHT ? MOMENT.TONIGHT : MOMENT.NOW;
  const channels = widgetChannels(settings, config);

  if (channels.length === 0) {
    return { ttl_seconds: TTL_MAX, components: [{ type: 'text', text: TEXTS.noChannel[l] }] };
  }

  const shown = channels.slice(0, MAX_ITEMS);
  const programmes = shown.map((channel) => {
    const schedule = findSchedule(guide, channel.id, now);
    return moment === MOMENT.NOW ? schedule.current : schedule.tonight;
  });

  const components = [
    {
      type: 'card-list',
      display: 'list',
      items: shown.map((channel, i) => buildItem(channel, programmes[i], moment, l, now)),
    },
  ];
  if (channels.length > MAX_ITEMS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: TEXTS.more[l](channels.length - MAX_ITEMS),
    });
  }

  // "Now": pull again when the first shown programme ends.
  let ttl = TTL_TONIGHT;
  if (moment === MOMENT.NOW) {
    const ends = programmes.filter(Boolean).map((p) => (p.stop - now) / 1000);
    ttl = ends.length > 0 ? Math.ceil(Math.min(...ends)) : TTL_MIN;
  }
  return {
    ttl_seconds: Math.min(TTL_MAX, Math.max(TTL_MIN, ttl)),
    components,
  };
}

/**
 * Handler of `onWidgetGet('tv_guide')`.
 */
// The core waits 15 s for a widget, then shows "data unavailable" and never
// retries until the dashboard is reloaded. Only the very first download can
// take that long (an old guide is served while a new one comes in): past this
// deadline the card says so, and the download keeps going for the next pull.
export const PULL_DEADLINE_MS = 9000;
const LOADING_TTL_SECONDS = 15;

export async function getTvGuideWidget(
  { settings, language },
  config,
  { deadlineMs = PULL_DEADLINE_MS } = {},
) {
  const download = getGuide();
  download.catch(() => {});
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
    timer.unref?.();
  });
  const guide = await Promise.race([download, late]).finally(() => clearTimeout(timer));
  if (!guide) {
    return {
      ttl_seconds: LOADING_TTL_SECONDS,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'Downloading the TV guide…',
            fr: 'Téléchargement du programme TV…',
          },
        },
      ],
    };
  }
  return buildWidgetContent(guide, { settings, language, config });
}
