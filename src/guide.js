// -----------------------------------------------------------------------------
// TV guide "driver": downloads and reads the free XMLTV guide of xmltvfr.fr.
//
// - one gzip file (~1 MB) holds ~8 days of programmes for the 30 TNT channels;
// - it is kept in memory and downloaded again only when it gets old, so a
//   short poll_frequency does NOT mean more downloads;
// - no dependency: Node 20+ provides `fetch` and `zlib`, and the XMLTV format
//   is simple enough to be read with a few regular expressions.
// -----------------------------------------------------------------------------

import { gunzipSync } from 'node:zlib';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'guide' });

export const GUIDE_URL = 'https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz';

// Download the guide again after this delay (the source is updated a few
// times a day).
export const GUIDE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// After a failed download, wait this long before trying again (the old guide
// keeps being served meanwhile, if we have one).
export const GUIDE_RETRY_DELAY_MS = 15 * 60 * 1000;

// French TV: times are displayed and "tonight" is computed in this zone,
// whatever the time zone of the container.
export const TIME_ZONE = 'Europe/Paris';
// "Tonight" = the programme on air at this time (French prime time).
export const PRIME_TIME = { hour: 21, minute: 10 };

// Maximum length of a published text state.
export const MAX_TEXT_LENGTH = 250;

// --- XMLTV parsing -----------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode the XML entities of a text node (&amp;, &#233;, &#xE9;...).
 * @param {string} text
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Parse an XMLTV date: `YYYYMMDDhhmmss +hhmm` (the offset is optional, UTC
 * when missing).
 * @param {string} value
 * @returns {Date|null}
 */
export function parseXmltvDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?/.exec(
    String(value ?? '').trim(),
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second = '0', sign, offH = '0', offM = '0'] = match;
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const offsetMinutes = (sign === '-' ? -1 : 1) * (+offH * 60 + +offM);
  return new Date(utc - offsetMinutes * 60_000);
}

function readTag(body, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(body);
  return match ? decodeEntities(match[1].trim()) : undefined;
}

function readAttribute(attributes, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match ? decodeEntities(match[1]) : undefined;
}

/**
 * Read an XMLTV document.
 * @param {string} xml
 * @returns {Map<string, Array<{ title: string, subTitle?: string, description?: string, category?: string, start: Date, stop: Date }>>}
 *   the programmes of each channel id, sorted by start time.
 */
export function parseXmltv(xml) {
  const programmes = new Map();
  const regex = /<programme\s([^>]*)>([\s\S]*?)<\/programme>/g;
  for (const [, attributes, body] of xml.matchAll(regex)) {
    const channel = readAttribute(attributes, 'channel');
    const start = parseXmltvDate(readAttribute(attributes, 'start'));
    const stop = parseXmltvDate(readAttribute(attributes, 'stop'));
    const title = readTag(body, 'title');
    if (!channel || !start || !stop || !title) {
      continue;
    }
    if (!programmes.has(channel)) {
      programmes.set(channel, []);
    }
    programmes.get(channel).push({
      title,
      subTitle: readTag(body, 'sub-title'),
      description: readTag(body, 'desc'),
      category: readTag(body, 'category'),
      start,
      stop,
    });
  }
  for (const list of programmes.values()) {
    list.sort((a, b) => a.start - b.start);
  }
  return programmes;
}

// --- Download + cache --------------------------------------------------------

let cache = null; // { fetchedAt: number, programmes: Map }
let lastFailureAt = 0;
let pending = null; // shared promise: several devices polled at once = 1 download

/**
 * Download and parse the guide (no cache).
 * @returns {Promise<Map>}
 */
export async function downloadGuide() {
  logger.info(`Downloading the TV guide <- ${GUIDE_URL}`);
  const response = await fetch(GUIDE_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`TV guide HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  // gzip magic number: 1f 8b. Anything else is read as plain XML.
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const xml = (isGzip ? gunzipSync(bytes) : bytes).toString('utf8');
  const programmes = parseXmltv(xml);
  if (programmes.size === 0) {
    throw new Error('TV guide is empty or unreadable');
  }
  logger.info(`TV guide loaded: ${programmes.size} channels`);
  return programmes;
}

/**
 * Return the guide, downloading it only when needed.
 * @param {{ now?: number, force?: boolean }} [options]
 * @returns {Promise<Map>}
 */
export async function getGuide({ now = Date.now(), force = false } = {}) {
  const fresh = cache && now - cache.fetchedAt < GUIDE_MAX_AGE_MS;
  const waitBeforeRetry = cache && now - lastFailureAt < GUIDE_RETRY_DELAY_MS;
  if (!force && (fresh || waitBeforeRetry)) {
    return cache.programmes;
  }
  const download = startDownload(now);
  // An old guide still covers several days: serve it while the new one comes
  // in. Waiting for the download instead (up to a minute) is what a widget
  // pull, a scene action and the programme watcher used to do every 6 hours,
  // and a widget that misses the core's 15 s ack is dead until a reload.
  if (cache && !force) {
    return cache.programmes;
  }
  return download;
}

/**
 * Download the guide, or join the download already running.
 * @param {number} now
 * @returns {Promise<Map>}
 */
function startDownload(now) {
  if (!pending) {
    pending = downloadGuide()
      .then((programmes) => {
        cache = { fetchedAt: now, programmes };
        lastFailureAt = 0;
        return programmes;
      })
      .catch((err) => {
        lastFailureAt = now;
        if (cache) {
          // Keep serving the old guide: it still covers several days.
          logger.warn('TV guide download failed, keeping the previous one', err);
          return cache.programmes;
        }
        throw err;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Forget the cached guide (tests). */
export function resetGuideCache() {
  cache = null;
  lastFailureAt = 0;
  pending = null;
}

// --- Schedule of a channel ---------------------------------------------------

// Parts of a date in the French time zone.
function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * The instant of "today at PRIME_TIME" in the French time zone.
 * @param {Date} now
 */
export function primeTimeOf(now) {
  const { year, month, day } = zonedParts(now);
  // First guess as if the zone was UTC, then remove the real offset.
  const guess = new Date(Date.UTC(year, month - 1, day, PRIME_TIME.hour, PRIME_TIME.minute));
  const seen = zonedParts(guess);
  const offsetMs =
    Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Current, next and tonight's programme of a channel.
 * @param {Map} guide result of getGuide()
 * @param {string} channelId XMLTV channel id
 * @param {Date} [now]
 */
export function findSchedule(guide, channelId, now = new Date()) {
  const list = guide.get(channelId) ?? [];
  const onAirAt = (date) => list.find((p) => p.start <= date && date < p.stop);
  const primeTime = primeTimeOf(now);
  return {
    current: onAirAt(now),
    next: list.find((p) => p.start > now),
    tonight: onAirAt(primeTime) ?? list.find((p) => p.start > primeTime),
  };
}

// --- Display -----------------------------------------------------------------

/**
 * Format a time as `20:45` in the French time zone.
 * @param {Date} date
 */
export function formatTime(date) {
  const { hour, minute } = zonedParts(date);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function truncate(text) {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

export function fullTitle(programme) {
  return programme.subTitle ? `${programme.title} - ${programme.subTitle}` : programme.title;
}

export const NO_PROGRAMME = 'Aucun programme';

/** `Titre (20:45 - 21:30)` */
export function formatCurrent(programme) {
  if (!programme) {
    return NO_PROGRAMME;
  }
  return truncate(
    `${fullTitle(programme)} (${formatTime(programme.start)} - ${formatTime(programme.stop)})`,
  );
}

/** `21:30 · Titre` */
export function formatUpcoming(programme) {
  if (!programme) {
    return NO_PROGRAMME;
  }
  return truncate(`${formatTime(programme.start)} · ${fullTitle(programme)}`);
}

/**
 * Programmes that started in the time window ]from, to], on every channel.
 * @param {Map} guide result of getGuide()
 * @param {Date} from excluded
 * @param {Date} to included
 * @returns {Array<{ channelId: string, programme: object }>} sorted by start time
 */
export function findStartedProgrammes(guide, from, to) {
  const started = [];
  for (const [channelId, list] of guide) {
    for (const programme of list) {
      if (programme.start > from && programme.start <= to) {
        started.push({ channelId, programme });
      }
    }
  }
  return started.sort((a, b) => a.programme.start - b.programme.start);
}
