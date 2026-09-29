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
import { parseXmltv, resetGuideCache } from '../src/guide.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const xml = await readFile(new URL('./fixtures/guide.xml', import.meta.url), 'utf8');
const config = normalizeConfig();
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetGuideCache();
});

function mockGuideDownload() {
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from(xml) });
}

test('one device per selected channel, with the configured poll_frequency', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, normalizeConfig({ poll_frequency: '30000' }));
  assert.equal(devices.length, config.channels.length);
  for (const device of devices) {
    assert.match(device.name, /^Programme TV /);
    assert.equal(device.poll_frequency, 30_000);
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

test('onPoll downloads the guide and publishes 3 text states', async () => {
  mockGuideDownload();
  const gladys = createFakeGladys();
  await tvChannel.onPoll(gladys, findChannel('TF1.fr'));
  assert.equal(gladys.published.length, 3);
  assert.ok(gladys.published.every((s) => typeof s.text === 'string' && s.text.length > 0));
});

test('the test_guide action returns a multi-language message', async () => {
  mockGuideDownload();
  const gladys = createFakeGladys();
  const message = await ACTIONS.test_guide(gladys, { fields: {}, config });
  assert.match(message.en, /TV guide OK \(2 channels\)/);
  assert.match(message.fr, /Guide TV OK \(2 chaînes\)/);
});
