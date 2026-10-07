import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {
  decodeEntities,
  findSchedule,
  formatCurrent,
  formatTime,
  formatUpcoming,
  getGuide,
  GUIDE_MAX_AGE_MS,
  GUIDE_RETRY_DELAY_MS,
  MAX_TEXT_LENGTH,
  NO_PROGRAMME,
  parseXmltv,
  parseXmltvDate,
  primeTimeOf,
  resetGuideCache,
} from '../src/guide.js';

const xml = await readFile(new URL('./fixtures/guide.xml', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetGuideCache();
});

function mockFetch(body, { ok = true, status = 200 } = {}) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok, status, arrayBuffer: async () => body };
  };
  return () => calls;
}

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
});

test('getGuide downloads a gzip guide once, then serves the cache', async () => {
  const calls = mockFetch(gzipSync(xml));
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
  mockFetch(Buffer.from(xml));
  const guide = await getGuide();
  assert.equal(guide.get('M6.fr')[0].title, 'Météo');
});

test('getGuide throws on HTTP error when there is no cached guide', async () => {
  mockFetch(null, { ok: false, status: 503 });
  await assert.rejects(() => getGuide(), /TV guide HTTP 503/);
});

test('getGuide throws on an empty guide', async () => {
  mockFetch(Buffer.from('<tv></tv>'));
  await assert.rejects(() => getGuide(), /empty or unreadable/);
});

test('getGuide keeps the old guide when a refresh fails, and waits before retrying', async () => {
  mockFetch(gzipSync(xml));
  const now = Date.now();
  const first = await getGuide({ now });

  const calls = mockFetch(null, { ok: false, status: 500 });
  const later = now + GUIDE_MAX_AGE_MS + 1;
  assert.equal(await getGuide({ now: later }), first);
  assert.equal(calls(), 1);
  // The old guide is served at once, the failed download settles behind it.
  await new Promise((resolve) => setImmediate(resolve));
  await getGuide({ now: later + 60_000 });
  assert.equal(calls(), 1, 'no new try before the retry delay');
  await getGuide({ now: later + GUIDE_RETRY_DELAY_MS + 1 });
  assert.equal(calls(), 2);
});

test('getGuide serves the old guide at once while a new one downloads', async () => {
  mockFetch(gzipSync(xml));
  const now = Date.now();
  const first = await getGuide({ now });

  // A download that never ends: the old guide must still come back right away.
  globalThis.fetch = () => new Promise(() => {});
  const started = Date.now();
  assert.equal(await getGuide({ now: now + GUIDE_MAX_AGE_MS + 1 }), first);
  assert.ok(Date.now() - started < 1000);
  resetGuideCache();
});
