import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {
  decodeEntities,
  findSchedule,
  formatCurrent,
  formatDateTime,
  formatTime,
  formatUpcoming,
  getGuide,
  GUIDE_FIRST_RETRY_DELAY_MS,
  GUIDE_MAX_AGE_MS,
  GUIDE_RETRY_DELAY_MS,
  guideInfo,
  isGuideOutdated,
  MAX_DOWNLOAD_BYTES,
  MAX_TEXT_LENGTH,
  MIN_GUIDE_CHANNELS,
  NO_PROGRAMME,
  parseXmltv,
  parseXmltvDate,
  primeTimeOf,
  resetGuideCache,
  truncate,
} from '../src/guide.js';
import { CHANNELS } from '../src/channels.js';
import { completeGuide, stubFetch } from './helpers/guide.js';

const xml = await readFile(new URL('./fixtures/guide.xml', import.meta.url), 'utf8');
const fullXml = completeGuide(xml);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetGuideCache();
});

function mockFetch(body, init) {
  const requests = stubFetch(() => new Response(body, init));
  return () => requests.length;
}

// Let a download that nobody waits for settle.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('parseXmltvDate reads the date and its offset', () => {
  assert.equal(parseXmltvDate('20260929204500 +0200').toISOString(), '2026-09-29T18:45:00.000Z');
  assert.equal(parseXmltvDate('20260101120000 -0130').toISOString(), '2026-01-01T13:30:00.000Z');
  assert.equal(parseXmltvDate('20260101120000').toISOString(), '2026-01-01T12:00:00.000Z');
  assert.equal(parseXmltvDate('garbage'), null);
});

test('decodeEntities decodes named and numeric entities', () => {
  assert.equal(
    decodeEntities('A &amp; B &lt;&gt; &quot;x&quot; l&apos;a &#233;t&#xE9;'),
    'A & B <> "x" l\'a été',
  );
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('decodeEntities replaces an invalid code point instead of throwing', () => {
  assert.equal(decodeEntities('a&#x110000;b'), 'a\uFFFDb');
  assert.equal(decodeEntities('&#99999999999999999999;'), '\uFFFD');
  assert.equal(decodeEntities('&#xD800;&#0;'), '\uFFFD\uFFFD');
  // One such entity used to make the whole guide unreadable.
  const guide = parseXmltv(
    '<tv><programme start="20260929200000 +0200" stop="20260929210000 +0200" channel="TF1.fr"><title>A &#x110000; B</title></programme></tv>',
  );
  assert.equal(guide.get('TF1.fr')[0].title, 'A \uFFFD B');
});

test('a CDATA section is read as it is, entities around it are decoded', () => {
  const guide = parseXmltv(
    '<tv><programme start="20260929200000 +0200" stop="20260929210000 +0200" channel="TF1.fr"><title><![CDATA[Tom & Jerry <3]]></title><desc>&lt;b&gt; <![CDATA[&amp;]]></desc></programme></tv>',
  );
  const [programme] = guide.get('TF1.fr');
  assert.equal(programme.title, 'Tom & Jerry <3');
  assert.equal(programme.description, '<b> &amp;');
});

test('parseXmltv groups the programmes by channel, sorted, and skips broken ones', () => {
  const guide = parseXmltv(xml);
  assert.deepEqual([...guide.keys()].sort(), ['M6.fr', 'TF1.fr']);
  const tf1 = guide.get('TF1.fr');
  assert.equal(tf1.length, 4);
  assert.equal(tf1[1].title, 'Quotidien & Cie');
  assert.equal(tf1[1].subTitle, "L'invité du soir");
  assert.equal(tf1[0].category, 'Information');
  assert.ok(tf1.every((p, i) => i === 0 || tf1[i - 1].start <= p.start));
});

test('findSchedule returns the current, next and tonight programmes', () => {
  const guide = parseXmltv(xml);
  const now = new Date('2026-09-29T18:00:00Z'); // 20:00 in Paris
  const { current, next, tonight } = findSchedule(guide, 'TF1.fr', now);
  assert.equal(current.title, 'Journal de 20H');
  assert.equal(next.title, 'Quotidien & Cie');
  assert.equal(tonight.title, 'Grand film');
});

test('findSchedule returns nothing for an unknown channel', () => {
  const guide = parseXmltv(xml);
  assert.deepEqual(findSchedule(guide, 'Nope.fr', new Date('2026-09-29T18:00:00Z')), {
    current: undefined,
    next: undefined,
    tonight: undefined,
  });
});

test('primeTimeOf follows the French time zone, summer and winter', () => {
  assert.equal(
    primeTimeOf(new Date('2026-09-29T08:00:00Z')).toISOString(),
    '2026-09-29T19:10:00.000Z',
  );
  assert.equal(
    primeTimeOf(new Date('2026-12-15T08:00:00Z')).toISOString(),
    '2026-12-15T20:10:00.000Z',
  );
  // 23:30 UTC on the 29th is already the 30th in Paris.
  assert.equal(
    primeTimeOf(new Date('2026-09-29T23:30:00Z')).toISOString(),
    '2026-09-30T19:10:00.000Z',
  );
});

test('texts are formatted in French time and stay short', () => {
  const guide = parseXmltv(xml);
  const [journal, quotidien] = guide.get('TF1.fr');
  assert.equal(formatTime(journal.start), '19:45');
  assert.equal(formatCurrent(journal), 'Journal de 20H (19:45 - 20:10)');
  assert.equal(formatUpcoming(quotidien), "20:10 · Quotidien & Cie - L'invité du soir");
  assert.equal(formatCurrent(undefined), NO_PROGRAMME);
  assert.equal(formatUpcoming(undefined), NO_PROGRAMME);
  const long = { ...journal, title: 'x'.repeat(500) };
  assert.equal(formatCurrent(long).length, MAX_TEXT_LENGTH);
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(formatDateTime(journal.start), '2026-09-29 19:45');
});

test('getGuide downloads a gzip guide once, then serves the cache', async () => {
  const calls = mockFetch(gzipSync(fullXml));
  const now = Date.now();
  const [a, b] = await Promise.all([getGuide({ now }), getGuide({ now })]);
  assert.equal(a, b);
  assert.equal(a.get('TF1.fr').length, 4);
  await getGuide({ now: now + 60_000 });
  assert.equal(calls(), 1, 'one download for concurrent and close calls');
  await getGuide({ now: now + GUIDE_MAX_AGE_MS + 1 });
  assert.equal(calls(), 2, 'downloaded again once too old');
});

test('getGuide also reads a plain (not gzip) XML file', async () => {
  mockFetch(Buffer.from(fullXml));
  const guide = await getGuide();
  assert.equal(guide.get('M6.fr')[0].title, 'Météo');
});

test('getGuide throws on HTTP error when there is no cached guide', async () => {
  mockFetch(null, { status: 503 });
  await assert.rejects(() => getGuide(), /TV guide HTTP 503/);
});

test('getGuide throws on an empty guide', async () => {
  mockFetch(Buffer.from('<tv></tv>'));
  await assert.rejects(() => getGuide(), /empty or unreadable/);
});

test('a guide cut before </tv> is refused, and the old one is kept', async () => {
  mockFetch(gzipSync(fullXml));
  const now = Date.now();
  const first = await getGuide({ now });

  // A file cut in the middle of the download: every channel but no </tv>.
  const cut = fullXml.slice(0, fullXml.lastIndexOf('<programme'));
  mockFetch(gzipSync(cut));
  await assert.rejects(
    () => getGuide({ now: now + GUIDE_MAX_AGE_MS + 1, force: true }),
    /truncated/,
  );
  assert.equal(await getGuide({ now: now + GUIDE_MAX_AGE_MS + 2 }), first);
});

test('a guide with too few of the known channels is refused', async () => {
  assert.ok(MIN_GUIDE_CHANNELS > 2 && MIN_GUIDE_CHANNELS <= CHANNELS.length);
  mockFetch(Buffer.from(xml)); // well-formed, but 2 channels only
  await assert.rejects(() => getGuide(), /incomplete: 2 of the 30 channels/);
});

test('without any guide, a failed download is not retried at once', async () => {
  const calls = mockFetch(null, { status: 503 });
  const now = Date.now();
  await assert.rejects(() => getGuide({ now }), /HTTP 503/);
  // Every caller within the delay fails at once, without downloading.
  await assert.rejects(() => getGuide({ now: now + 30_000 }), /unavailable, next try in 90 s/);
  await assert.rejects(() => getGuide({ now: now + 60_000 }), /unavailable/);
  assert.equal(calls(), 1);
  mockFetch(Buffer.from(fullXml));
  assert.ok(await getGuide({ now: now + GUIDE_FIRST_RETRY_DELAY_MS }));
  assert.ok(GUIDE_FIRST_RETRY_DELAY_MS < GUIDE_RETRY_DELAY_MS);
});

test('a forced download reports its failure, even with an old guide', async () => {
  mockFetch(Buffer.from(fullXml));
  const now = Date.now();
  const first = await getGuide({ now });
  mockFetch(null, { status: 500 });
  await assert.rejects(() => getGuide({ now: now + 1000, force: true }), /HTTP 500/);
  // The old guide stays in use.
  assert.equal(await getGuide({ now: now + 2000 }), first);
});

test('getGuide keeps the old guide when a refresh fails, and waits before retrying', async () => {
  mockFetch(gzipSync(fullXml));
  const now = Date.now();
  const first = await getGuide({ now });

  const calls = mockFetch(null, { status: 500 });
  const later = now + GUIDE_MAX_AGE_MS + 1;
  assert.equal(await getGuide({ now: later }), first);
  assert.equal(calls(), 1);
  // The old guide is served at once, the failed download settles behind it.
  await settle();
  await getGuide({ now: later + 60_000 });
  assert.equal(calls(), 1, 'no new try before the retry delay');
  await getGuide({ now: later + GUIDE_RETRY_DELAY_MS + 1 });
  assert.equal(calls(), 2);
});

test('getGuide serves the old guide at once while a new one downloads', async () => {
  mockFetch(gzipSync(fullXml));
  const now = Date.now();
  const first = await getGuide({ now });

  // A download that never ends: the old guide must still come back right away.
  globalThis.fetch = () => new Promise(() => {});
  const started = Date.now();
  assert.equal(await getGuide({ now: now + GUIDE_MAX_AGE_MS + 1 }), first);
  assert.ok(Date.now() - started < 1000);
  resetGuideCache();
});

test('a download announcing more than the cap is refused before reading it', async () => {
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  stubFetch(
    () => new Response(body, { headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) } }),
  );
  await assert.rejects(() => getGuide(), /too large: \d+ bytes announced/);
  // A stream fills its first chunk on its own; nothing past it is read.
  assert.ok(pulled <= 1, `${pulled} chunks read`);
});

test('a download growing past the cap is cut', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  stubFetch(() => new Response(body)); // no Content-Length
  await assert.rejects(() => getGuide(), /too large: more than/);
  assert.ok(sent <= MAX_DOWNLOAD_BYTES / chunk.length + 2, `${sent} chunks read`);
});

test('a gzip file inflating past the XML cap is refused', async () => {
  mockFetch(gzipSync(Buffer.alloc(101 * 1024 * 1024)));
  await assert.rejects(() => getGuide(), /too large: more than \d+ bytes of XML/);
});

test('the guide is downloaded again only when it changed (ETag / Last-Modified)', async () => {
  const etag = '"b5d97-65d4ab0ab5f34"';
  const lastModified = 'Thu, 08 Oct 2026 02:07:13 GMT';
  const requests = stubFetch(({ headers }) =>
    headers['If-None-Match'] === etag
      ? new Response(null, { status: 304 })
      : new Response(gzipSync(fullXml), { headers: { etag, 'last-modified': lastModified } }),
  );
  const now = Date.now();
  const first = await getGuide({ now });
  assert.deepEqual(requests[0].headers, {}, 'the first download is unconditional');

  const later = now + GUIDE_MAX_AGE_MS + 1;
  await getGuide({ now: later });
  await settle();
  assert.deepEqual(requests[1].headers, {
    'If-None-Match': etag,
    'If-Modified-Since': lastModified,
  });
  // 304: the same guide, now fresh again.
  assert.equal(await getGuide({ now: later + 60_000 }), first);
  assert.equal(requests.length, 2);
  assert.equal(guideInfo().fetchedAt, later);
});

test('a guide whose last programme has ended is outdated', async () => {
  mockFetch(Buffer.from(fullXml)); // programmes of 2026-09-29 and 2000-01-01
  assert.equal(isGuideOutdated(), false, 'no guide is not an outdated guide');
  await getGuide();
  assert.equal(isGuideOutdated(), true);
  assert.equal(isGuideOutdated(Date.parse('2026-09-29T22:00:00Z')), false);
  assert.equal(guideInfo().coversUntil, Date.parse('2026-09-29T22:30:00Z'));
  assert.equal(guideInfo().channels, CHANNELS.length);
});
