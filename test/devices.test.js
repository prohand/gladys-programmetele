import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  ACTIONS,
  buildDiscoveredDevices,
  findChannelByDevice,
  selectedChannels,
} from '../src/devices/index.js';
import { FEATURE, tvChannel } from '../src/devices/tvChannel.js';
import { CHANNELS, findChannel } from '../src/channels.js';
import { getGuide, parseXmltv, resetGuideCache } from '../src/guide.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { completeGuide, stubFetch, stubGuideDownload } from './helpers/guide.js';

const xml = await readFile(new URL('./fixtures/guide.xml', import.meta.url), 'utf8');
const config = normalizeConfig();
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetGuideCache();
});

test('one device per selected channel, polled every minute', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, normalizeConfig({ poll_frequency: '30000' }));
  assert.equal(devices.length, config.channels.length);
  for (const device of devices) {
    assert.match(device.name, /^Programme TV /);
    assert.equal(device.poll_frequency, 60_000);
    // Without should_poll the core never schedules the device.
    assert.equal(device.should_poll, true);
    assert.equal(device.features.length, 3);
  }
});

test('device external_ids are unique across all channels', () => {
  const gladys = createFakeGladys();
  const all = buildDiscoveredDevices(
    gladys,
    normalizeConfig({ channels: CHANNELS.map((c) => c.id) }),
  );
  assert.equal(all.length, CHANNELS.length);
  const ids = all.map((d) => d.external_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('features are read-only text sensors', () => {
  const gladys = createFakeGladys();
  const device = tvChannel.buildDevice(gladys, findChannel('TF1.fr'), config);
  for (const feature of device.features) {
    assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.TEXT);
    assert.equal(feature.type, DEVICE_FEATURE_TYPES.TEXT.TEXT);
    assert.equal(feature.read_only, true);
  }
  assert.deepEqual(
    device.features.map((f) => f.external_id),
    Object.values(FEATURE).map((key) => `tv-channel:TF1.fr:${key}`),
  );
});

test('an empty channel list publishes no device', () => {
  const gladys = createFakeGladys();
  assert.deepEqual(buildDiscoveredDevices(gladys, normalizeConfig({ channels: [] })), []);
});

test('findChannelByDevice routes any channel device, even an unselected one', () => {
  const gladys = createFakeGladys();
  for (const channel of CHANNELS) {
    const external_id = tvChannel.deviceExternalId(gladys, channel);
    assert.equal(findChannelByDevice(gladys, { external_id }), channel);
  }
  assert.equal(findChannelByDevice(gladys, { external_id: 'nope' }), undefined);
});

test('selectedChannels keeps the configuration order', () => {
  const list = selectedChannels(normalizeConfig({ channels: ['M6.fr', 'TF1.fr'] }));
  assert.deepEqual(
    list.map((c) => c.name),
    ['M6', 'TF1'],
  );
});

test('buildStates publishes the 3 texts of a channel', () => {
  const gladys = createFakeGladys();
  const guide = parseXmltv(xml);
  const states = tvChannel.buildStates(
    gladys,
    findChannel('TF1.fr'),
    guide,
    new Date('2026-09-29T18:00:00Z'),
  );
  assert.deepEqual(states, [
    {
      device_feature_external_id: 'tv-channel:TF1.fr:current',
      text: 'Journal de 20H (19:45 - 20:10)',
    },
    {
      device_feature_external_id: 'tv-channel:TF1.fr:next',
      text: "20:10 · Quotidien & Cie - L'invité du soir",
    },
    { device_feature_external_id: 'tv-channel:TF1.fr:tonight', text: '21:10 · Grand film' },
  ]);
});

test('the test_guide action returns a multi-language message', async () => {
  stubGuideDownload();
  const gladys = createFakeGladys();
  const message = await ACTIONS.test_guide(gladys, { fields: {}, config });
  assert.match(message.en, /TV guide OK \(30 channels\)/);
  assert.match(message.fr, /Guide TV OK \(30 chaînes\)/);
});

test('test_guide says the download failed, with no guide yet', async () => {
  stubFetch(() => new Response(null, { status: 503 }));
  const message = await ACTIONS.test_guide(createFakeGladys(), { fields: {}, config });
  assert.match(
    message.en,
    /^TV guide download failed \(TV guide HTTP 503\)\. No guide available yet/,
  );
  assert.match(message.fr, /^Échec du téléchargement du guide TV .*Aucun guide disponible/);
});

test('test_guide says the download failed and that the previous guide is still used', async () => {
  // A guide that still covers the present.
  stubGuideDownload(
    completeGuide(xml, { start: Date.now() - 3600_000, stop: Date.now() + 3600_000 }),
  );
  await getGuide();
  stubFetch(() => new Response(null, { status: 500 }));
  const message = await ACTIONS.test_guide(createFakeGladys(), { fields: {}, config });
  assert.doesNotMatch(message.en, /OK/);
  assert.match(
    message.en,
    /download failed \(TV guide HTTP 500\)\. The previous guide .* is still used\./,
  );
  assert.match(
    message.fr,
    /L'ancien guide \(téléchargé le \d{4}-\d\d-\d\d \d\d:\d\d, .*\) reste utilisé\./,
  );
});

test('test_guide says when the previous guide has nothing left to show', async () => {
  stubGuideDownload(); // the fixture: programmes of 2026-09-29 and 2000
  await getGuide();
  stubFetch(() => new Response(null, { status: 500 }));
  const message = await ACTIONS.test_guide(createFakeGladys(), { fields: {}, config });
  assert.match(message.en, /has ended on 2026-09-30 00:30: nothing left to show/);
  assert.match(message.fr, /s'est terminé le 2026-09-30 00:30 : plus rien à afficher/);
});
