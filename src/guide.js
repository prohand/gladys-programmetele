// -----------------------------------------------------------------------------
// TV guide "driver": downloads and reads the free XMLTV guide of xmltvfr.fr.
//
// - one gzip file (~1 MB) holds ~8 days of programmes for the 30 TNT channels;
// - it is kept in memory and downloaded again only when it gets old, so a
//   short poll_frequency does NOT mean more downloads;
// - no dependency: Node 24 provides `fetch` and `zlib`, and the XMLTV format
//   is simple enough to be read with a few regular expressions.
// -----------------------------------------------------------------------------

import { gunzipSync } from 'node:zlib';
import { createLogger } from '@gladysassistant/integration-sdk';
import { CHANNELS } from './channels.js';

const logger = createLogger({ name: 'guide' });

export const GUIDE_URL = 'https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz';

// Download the guide again after this delay (the source is updated a few
// times a day).
export const GUIDE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// After a failed download, wait this long before trying again (the old guide
// keeps being served meanwhile, if we have one).
export const GUIDE_RETRY_DELAY_MS = 15 * 60 * 1000;
// Same, when there is NO guide yet. Shorter, because every sensor, the widget
// and the scenes are empty until one comes in; but never zero: four paths ask
// for the guide every minute (poll, refresh loop, watcher, widget), and a
// source down at the very first start would otherwise be hit several times a
// minute. 2 min caps that at 30 tries an hour, and in between they fail at once.
export const GUIDE_FIRST_RETRY_DELAY_MS = 2 * 60 * 1000;

// Size caps of a download. The real feed is ~745 KB gzip and ~5.2 MB of XML:
// 20 MB / 100 MB leave room for years of growth, and still stop a broken or
// hostile server from filling the memory of a small Gladys box.
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_XML_BYTES = 100 * 1024 * 1024;

// A guide is accepted only when it lists at least this many of the known
// channels. The feed always carries all 30: a file cut in the middle, or a
// source serving a partial export, would otherwise replace a good cache for
// 6 hours with a few channels and leave the others on "Aucun programme".
// Half is far below a normal feed and far above a broken one.
export const MIN_GUIDE_CHANNELS = Math.ceil(CHANNELS.length / 2);

// French TV: times are displayed and "tonight" is computed in this zone,
// whatever the time zone of the container.
export const TIME_ZONE = 'Europe/Paris';
// "Tonight" = the programme on air at this time (French prime time).
export const PRIME_TIME = { hour: 21, minute: 10 };

// Maximum length of a published text state.
export const MAX_TEXT_LENGTH = 250;

// --- XMLTV parsing -----------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const REPLACEMENT_CHARACTER = '\uFFFD';

// A numeric reference that is not a Unicode scalar value (above U+10FFFF, a
// lone surrogate, or NUL). `String.fromCodePoint` throws on the first kind,
// and one such entity used to make the whole guide unreadable.
const isValidCodePoint = (code) =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);

/**
 * Decode the XML entities of a text node (&amp;, &#233;, &#xE9;...). An
 * invalid numeric reference becomes U+FFFD, the replacement character.
 * @param {string} text
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : REPLACEMENT_CHARACTER;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Read a text node: entities are decoded, CDATA sections are taken as they
 * are (an `&amp;` inside one is literally `&amp;`).
 * @param {string} text
 */
export function decodeText(text) {
  let decoded = '';
  let last = 0;
  for (const match of text.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    decoded += decodeEntities(text.slice(last, match.index)) + match[1];
    last = match.index + match[0].length;
  }
  return decoded + decodeEntities(text.slice(last));
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
  return match ? decodeText(match[1]).trim() || undefined : undefined;
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

/**
 * Refuse a guide that cannot be the whole feed: one with no closing `</tv>`
 * (a file cut during the download) or with too few of the known channels.
 * @param {string} xml
 * @param {Map} programmes result of parseXmltv(xml)
 */
export function checkGuideComplete(xml, programmes) {
  if (!xml.trimEnd().endsWith('</tv>')) {
    throw new Error('TV guide is truncated (no closing </tv>)');
  }
  if (programmes.size === 0) {
    throw new Error('TV guide is empty or unreadable');
  }
  const known = CHANNELS.filter((channel) => programmes.has(channel.id)).length;
  if (known < MIN_GUIDE_CHANNELS) {
    throw new Error(
      `TV guide is incomplete: ${known} of the ${CHANNELS.length} channels (${MIN_GUIDE_CHANNELS} needed)`,
    );
  }
}

/**
 * End of the last programme of the guide, on any channel.
 * @param {Map} guide result of parseXmltv()
 * @returns {number} ms since epoch, 0 for an empty guide
 */
export function guideEnd(guide) {
  let end = 0;
  for (const list of guide.values()) {
    for (const programme of list) {
      end = Math.max(end, programme.stop.getTime());
    }
  }
  return end;
}

// --- Download + cache --------------------------------------------------------

// { fetchedAt: number, programmes: Map, coversUntil: number, etag?: string, lastModified?: string }
let cache = null;
let lastFailure = null; // { at: number, error: Error }
let pending = null; // shared promise: several devices polled at once = 1 download
// Bumped by resetGuideCache(): a download still running then must not write
// its result into the state of the next test.
let generation = 0;

// Read a response body, refusing it past `max` bytes: the announced
// Content-Length is checked first, then the bytes actually received (a server
// may announce nothing, or lie).
async function readCappedBody(response, max) {
  const announced = Number(response.headers.get('content-length'));
  if (announced > max) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`TV guide too large: ${announced} bytes announced (limit ${max})`);
  }
  const chunks = [];
  let size = 0;
  // Throwing out of the loop cancels the stream: the rest is never downloaded.
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > max) {
      throw new Error(`TV guide too large: more than ${max} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function unpack(bytes) {
  // gzip magic number: 1f 8b. Anything else is read as plain XML.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return bytes;
  }
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_XML_BYTES });
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`TV guide too large: more than ${MAX_XML_BYTES} bytes of XML`, {
        cause: err,
      });
    }
    throw err;
  }
}

/**
 * Download and parse the guide (no cache). With the validators of the guide
 * already held, the request is conditional, and an unchanged feed costs a
 * 304 instead of the whole file.
 * @param {{ etag?: string, lastModified?: string }} [validators]
 * @returns {Promise<{ notModified: true } | { programmes: Map, etag?: string, lastModified?: string }>}
 */
export async function downloadGuide({ etag, lastModified } = {}) {
  logger.info(`Downloading the TV guide <- ${GUIDE_URL}`);
  const headers = {};
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  if (lastModified) {
    headers['If-Modified-Since'] = lastModified;
  }
  const response = await fetch(GUIDE_URL, { headers, signal: AbortSignal.timeout(60_000) });
  if (response.status === 304 && (etag || lastModified)) {
    logger.info('TV guide not modified since the last download');
    return { notModified: true };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`TV guide HTTP ${response.status}`);
  }
  const xml = unpack(await readCappedBody(response, MAX_DOWNLOAD_BYTES)).toString('utf8');
  const programmes = parseXmltv(xml);
  checkGuideComplete(xml, programmes);
  logger.info(`TV guide loaded: ${programmes.size} channels`);
  return {
    programmes,
    etag: response.headers.get('etag') ?? undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
  };
}

/**
 * Return the guide, downloading it only when needed.
 *
 * - fresh guide, or old one within the retry delay of a failure: served as is;
 * - old guide: served at once, a new one downloads behind it;
 * - no guide: the first download is waited for; after a failure, the calls
 *   within GUIDE_FIRST_RETRY_DELAY_MS fail at once instead of downloading;
 * - `force` (the "test" button): always downloads, and REJECTS when that
 *   download fails, even with an old guide in memory.
 * @param {{ now?: number, force?: boolean }} [options]
 * @returns {Promise<Map>}
 */
export async function getGuide({ now = Date.now(), force = false } = {}) {
  if (!force) {
    const fresh = cache && now - cache.fetchedAt < GUIDE_MAX_AGE_MS;
    const sinceFailure = lastFailure ? now - lastFailure.at : Infinity;
    if (cache && (fresh || sinceFailure < GUIDE_RETRY_DELAY_MS)) {
      return cache.programmes;
    }
    if (!cache && sinceFailure < GUIDE_FIRST_RETRY_DELAY_MS) {
      const wait = Math.ceil((GUIDE_FIRST_RETRY_DELAY_MS - sinceFailure) / 1000);
      throw new Error(`TV guide unavailable, next try in ${wait} s: ${lastFailure.error.message}`, {
        cause: lastFailure.error,
      });
    }
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
 * Download the guide, or join the download already running. Rejects when
 * the download fails; the old guide, if any, stays in the cache.
 * @param {number} now
 * @returns {Promise<Map>}
 */
function startDownload(now) {
  if (!pending) {
    const started = generation;
    pending = downloadGuide(cache ?? {})
      .then((result) => {
        if (started !== generation) {
          return result.programmes;
        }
        if (result.notModified) {
          if (!cache) {
            throw new Error('TV guide HTTP 304 with no guide in memory');
          }
          // Unchanged on the server: the guide in memory is as fresh as a new
          // download would have been.
          cache = { ...cache, fetchedAt: now };
        } else {
          const { programmes, etag, lastModified } = result;
          cache = {
            fetchedAt: now,
            programmes,
            coversUntil: guideEnd(programmes),
            etag,
            lastModified,
          };
        }
        lastFailure = null;
        return cache.programmes;
      })
      .catch((err) => {
        if (started !== generation) {
          throw err;
        }
        lastFailure = { at: now, error: err };
        if (cache) {
          // Nobody else sees this failure: the old guide was served instead.
          logger.warn('TV guide download failed, keeping the previous one', err);
        }
        throw err;
      })
      .finally(() => {
        if (started === generation) {
          pending = null;
        }
      });
    // The callers served with the old guide do not wait for this download:
    // its failure must not become an unhandled rejection.
    pending.catch(() => {});
  }
  return pending;
}

/**
 * What the guide in memory is, for the status and the "test" button.
 * @returns {{ fetchedAt: number, coversUntil: number, channels: number } | null}
 */
export function guideInfo() {
  return cache
    ? {
        fetchedAt: cache.fetchedAt,
        coversUntil: cache.coversUntil,
        channels: cache.programmes.size,
      }
    : null;
}

/**
 * True when the guide in memory has nothing left to show: its last programme
 * has ended. Happens only when the source stayed down (or stopped updating)
 * for about the 8 days a feed covers.
 * @param {number} [now]
 */
export function isGuideOutdated(now = Date.now()) {
  return cache !== null && now >= cache.coversUntil;
}

/** Forget the cached guide (tests). */
export function resetGuideCache() {
  generation += 1;
  cache = null;
  lastFailure = null;
  pending = null;
}

// --- Schedule of a channel ---------------------------------------------------

// Built once: an Intl.DateTimeFormat is costly to create, and this one is used
// for every time of every published text.
const PARIS_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

// Parts of a date in the French time zone.
function zonedParts(date) {
  const parts = PARIS_PARTS.formatToParts(date);
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

const pad = (value) => String(value).padStart(2, '0');

/**
 * Format a time as `20:45` in the French time zone.
 * @param {Date|number} date
 */
export function formatTime(date) {
  const { hour, minute } = zonedParts(date);
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * Format a date and time as `2026-10-08 20:45` in the French time zone (one
 * unambiguous form for both languages).
 * @param {Date|number} date
 */
export function formatDateTime(date) {
  const { year, month, day, hour, minute } = zonedParts(date);
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
}

/**
 * Cut a text to `max` characters, the last one being an ellipsis.
 * @param {string} text
 * @param {number} [max]
 */
export function truncate(text, max = MAX_TEXT_LENGTH) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
