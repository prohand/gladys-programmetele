import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildStartedEvent,
  createProgrammeWatcher,
  getProgrammeAction,
  MAX_CATCH_UP_MS,
  TRIGGER_PROGRAMME_STARTED,
  WATCH_INTERVAL_MS,
} from '../src/scenes.js';
import { findStartedProgrammes, parseXmltv, resetGuideCache } from '../src/guide.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { completeGuide, stubGuideDownload } from './helpers/guide.js';

const xml = await readFile(new URL('./fixtures/guide.xml', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;

afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
  resetGuideCache();
});

const mockGuideDownload = () => stubGuideDownload();

// Let the checks started by the watcher's timers run to their end.
async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('findStartedProgrammes returns the programmes started in ]from, to]', () => {
  const guide = parseXmltv(xml);
  // 20:00 Paris: M6 "Météo" starts exactly then; TF1 "Quotidien" at 20:10.
  const started = findStartedProgrammes(
    guide,
    new Date('2026-09-29T17:59:00Z'),
    new Date('2026-09-29T18:10:00Z'),
  );
  assert.deepEqual(
    started.map((s) => s.programme.title),
    ['Météo', 'Quotidien & Cie'],
  );
  // `from` is excluded: no double fire between two checks.
  assert.equal(
    findStartedProgrammes(guide, new Date('2026-09-29T18:10:00Z'), new Date('2026-09-29T18:11:00Z'))
      .length,
    0,
  );
});

test('buildStartedEvent builds flat data with the declared keys', () => {
  const guide = parseXmltv(xml);
  const film = guide.get('TF1.fr')[2];
  assert.deepEqual(buildStartedEvent('TF1.fr', film), {
    channel: 'TF1.fr',
    channel_name: 'TF1',
    title: 'Grand film',
    sub_title: null,
    category: 'Film',
    start: '21:10',
    stop: '23:00',
    duration_minutes: 110,
  });
});

test('the watcher never replays the past on its first check', async () => {
  mockGuideDownload();
  const gladys = createFakeGladys();
  const watcher = createProgrammeWatcher(gladys);
  assert.deepEqual(await watcher.check(new Date('2026-09-29T18:15:00Z')), []);
  assert.equal(gladys.sceneEvents.length, 0);
});

test('the watcher fires each started programme once, then refreshes the widget', async () => {
  mockGuideDownload();
  const gladys = createFakeGladys();
  let refreshed = 0;
  const watcher = createProgrammeWatcher(gladys, { onStarted: () => (refreshed += 1) });
  await watcher.check(new Date('2026-09-29T17:59:30Z'));
  await watcher.check(new Date('2026-09-29T18:00:30Z')); // M6 Météo at 20:00
  await watcher.check(new Date('2026-09-29T18:01:30Z')); // nothing new
  await watcher.check(new Date('2026-09-29T18:10:30Z')); // TF1 Quotidien at 20:10
  assert.deepEqual(
    gladys.sceneEvents.map((e) => [e.key, e.data.channel, e.data.title]),
    [
      [TRIGGER_PROGRAMME_STARTED, 'M6.fr', 'Météo'],
      [TRIGGER_PROGRAMME_STARTED, 'TF1.fr', 'Quotidien & Cie'],
    ],
  );
  assert.equal(refreshed, 2);
});

test('two checks waiting for the same download do not fire a programme twice', async () => {
  let release;
  const download = new Promise((resolve) => (release = resolve));
  globalThis.fetch = async () => {
    await download;
    return new Response(Buffer.from(completeGuide(xml)));
  };
  const gladys = createFakeGladys();
  const watcher = createProgrammeWatcher(gladys);
  await watcher.check(new Date('2026-09-29T17:59:30Z'));
  // The second check starts while the first still waits for the guide.
  const first = watcher.check(new Date('2026-09-29T18:00:30Z'));
  const second = watcher.check(new Date('2026-09-29T18:01:30Z'));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.data.title),
    ['Météo'],
  );
});

test('the watcher drops programmes started too long ago after a pause', async () => {
  mockGuideDownload();
  const gladys = createFakeGladys();
  const watcher = createProgrammeWatcher(gladys);
  await watcher.check(new Date('2026-09-29T17:50:00Z'));
  // Long pause: 20:00 and 20:10 starts are older than MAX_CATCH_UP_MS.
  const late = new Date(Date.parse('2026-09-29T18:10:00Z') + MAX_CATCH_UP_MS + 60_000);
  await watcher.check(late);
  assert.equal(gladys.sceneEvents.length, 0);
});

test('the watcher checks at the start of every minute, and stops cleanly', async () => {
  mockGuideDownload();
  mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.parse('2026-09-29T17:59:30Z'),
  });
  const gladys = createFakeGladys();
  const watcher = createProgrammeWatcher(gladys);
  watcher.start(); // first check: baseline only
  await flush();
  // M6 "Météo" starts at 18:00:00Z: the check aligned on the minute fires it
  // right then, not up to a minute later.
  mock.timers.tick(30_000 - 1);
  await flush();
  assert.equal(gladys.sceneEvents.length, 0);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.data.title),
    ['Météo'],
  );
  // Then every minute: TF1 "Quotidien" at 18:10:00Z.
  mock.timers.tick(10 * WATCH_INTERVAL_MS);
  await flush();
  assert.equal(gladys.sceneEvents.length, 2);
  watcher.stop();
  mock.timers.tick(2 * 60 * 60 * 1000); // 21:10 Paris: "Grand film" would fire
  await flush();
  assert.equal(gladys.sceneEvents.length, 2, 'no check after stop()');
});

test('after a reconnection, the watcher catches up on the last 5 minutes', async () => {
  mockGuideDownload();
  mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.parse('2026-09-29T17:58:00Z'),
  });
  const gladys = createFakeGladys();
  const watcher = createProgrammeWatcher(gladys);
  watcher.start();
  await flush();
  // Disconnected from 17:59 to 18:02: "Météo" (18:00) started meanwhile.
  mock.timers.tick(60_000);
  await flush();
  watcher.stop();
  mock.timers.tick(3 * 60_000);
  watcher.start();
  await flush();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.data.title),
    ['Météo'],
  );
  watcher.stop();
});

test('a reconnection long after does not replay more than 5 minutes', async () => {
  mockGuideDownload();
  mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.parse('2026-09-29T17:58:00Z'),
  });
  const gladys = createFakeGladys();
  const watcher = createProgrammeWatcher(gladys);
  watcher.start();
  await flush();
  watcher.stop();
  // Back at 18:14: "Météo" (18:00) is too old, "Quotidien" (18:10) is not.
  mock.timers.tick(16 * 60_000);
  watcher.start();
  await flush();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.data.title),
    ['Quotidien & Cie'],
  );
  watcher.stop();
});

test('a refused event does not stop the following ones', async () => {
  // Two programmes starting at the same time (20:00 Paris).
  const sameStart = (channel) =>
    `<programme start="20260929200000 +0200" stop="20260929210000 +0200" channel="${channel}"><title>X</title></programme>`;
  stubGuideDownload(completeGuide(`<tv>${sameStart('TF1.fr')}${sameStart('M6.fr')}</tv>`));
  const gladys = createFakeGladys();
  let calls = 0;
  gladys.publishSceneEvent = async () => {
    calls += 1;
    if (calls === 1) throw new Error('429');
  };
  const watcher = createProgrammeWatcher(gladys);
  await watcher.check(new Date('2026-09-29T17:59:30Z'));
  await watcher.check(new Date('2026-09-29T18:00:30Z'));
  assert.equal(calls, 2);
});

test('get_programme returns the declared outputs', async () => {
  mockGuideDownload();
  const outputs = await getProgrammeAction({ channel: 'TF1.fr' }, new Date('2026-09-29T18:00:00Z'));
  assert.deepEqual(outputs, {
    channel_name: 'TF1',
    current: 'Journal de 20H (19:45 - 20:10)',
    current_title: 'Journal de 20H',
    next: "20:10 · Quotidien & Cie - L'invité du soir",
    next_title: 'Quotidien & Cie',
    next_start: '20:10',
    tonight: '21:10 · Grand film',
    tonight_title: 'Grand film',
    tonight_start: '21:10',
  });
});

test('get_programme fails on an unknown channel', async () => {
  await assert.rejects(() => getProgrammeAction({ channel: 'Nope.fr' }), /Unknown channel/);
});
