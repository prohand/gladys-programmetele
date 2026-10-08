import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createIntegration, STATUS, STATUS_MESSAGES } from '../src/integration.js';
import { tvChannel } from '../src/devices/tvChannel.js';
import { findChannel } from '../src/channels.js';
import { resetGuideCache } from '../src/guide.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { completeGuide, fixtureXml, stubFetch, stubGuideDownload } from './helpers/guide.js';

const realFetch = globalThis.fetch;
const running = [];

afterEach(() => {
  running.splice(0).forEach((integration) => integration.stop());
  globalThis.fetch = realFetch;
  resetGuideCache();
});

// A guide that still covers the present: the status can then be OK.
const currentGuide = () =>
  completeGuide(fixtureXml, { start: Date.now() - 3600_000, stop: Date.now() + 3600_000 });

function fakeWatcher() {
  return {
    starts: 0,
    stops: 0,
    start() {
      this.starts += 1;
    },
    stop() {
      this.stops += 1;
    },
  };
}

// An integration with TF1 selected and its device already created in Gladys.
function setup({ watcher = fakeWatcher() } = {}) {
  const gladys = createFakeGladys();
  gladys.config = { channels: ['TF1.fr'] };
  gladys.devices = [{ external_id: tvChannel.deviceExternalId(gladys, findChannel('TF1.fr')) }];
  gladys.getConfig = async () => {
    throw new Error('getConfig must not be called: the SDK already fetched the config');
  };
  const integration = createIntegration(gladys, { watcher });
  running.push(integration);
  return { gladys, integration, watcher };
}

const lastStatus = (gladys) => gladys.connectionStatuses.at(-1);

test('on connection, the configuration fetched by the SDK is used as is', async () => {
  stubGuideDownload(currentGuide());
  const { gladys, integration } = setup();
  gladys.config = { channels: ['Arte.fr'] };
  await integration.onConnected();
  assert.deepEqual(integration.config.channels, ['Arte.fr']);
  assert.deepEqual(
    gladys.discovered[0].map((device) => device.external_id),
    ['tv-channel:Arte.fr'],
  );
});

test('on connection, the devices are published, the sensors filled, the status OK', async () => {
  stubGuideDownload(currentGuide());
  const { gladys, integration, watcher } = setup();
  await integration.onConnected();
  assert.equal(watcher.starts, 1);
  assert.equal(gladys.discovered.length, 1);
  assert.equal(gladys.published.length, 3, '3 texts for TF1');
  assert.deepEqual(gladys.connectionStatuses, [{ connected: true, message: undefined }]);
});

test('a refused device publication neither stops the watcher nor the sensors', async () => {
  stubGuideDownload(currentGuide());
  const { gladys, integration, watcher } = setup();
  gladys.publishDiscoveredDevices = async () => {
    throw new Error('HTTP 422');
  };
  await integration.onConnected();
  assert.equal(watcher.starts, 1, 'the watcher is started anyway');
  assert.equal(gladys.published.length, 3, 'the created devices are still filled');
  // Said as such, not as a download failure.
  assert.deepEqual(lastStatus(gladys), {
    connected: false,
    message: STATUS_MESSAGES[STATUS.DEVICES_REFUSED],
  });
  assert.match(lastStatus(gladys).message.fr, /refusé les appareils/);

  // The refresh loop publishes them again, and the status recovers.
  gladys.publishDiscoveredDevices = async (devices) => gladys.discovered.push(devices);
  await integration.refreshCycle();
  assert.equal(gladys.discovered.length, 1);
  assert.deepEqual(lastStatus(gladys), { connected: true, message: undefined });
});

test('a failed download at connection neither stops the watcher nor throws', async () => {
  stubFetch(() => new Response(null, { status: 503 }));
  const { gladys, integration, watcher } = setup();
  gladys.config = null; // whatever the SDK holds
  await integration.onConnected();
  assert.equal(watcher.starts, 1);
  assert.deepEqual(lastStatus(gladys), {
    connected: false,
    message: STATUS_MESSAGES[STATUS.GUIDE_UNAVAILABLE],
  });
  assert.match(lastStatus(gladys).message.fr, /Impossible de télécharger/);
});

test('the download and the publication failures have different messages', () => {
  const messages = Object.values(STATUS_MESSAGES).map((message) => message.fr);
  assert.equal(new Set(messages).size, messages.length);
  for (const message of Object.values(STATUS_MESSAGES)) {
    assert.ok(message.en && message.fr);
  }
});

test('refused states are reported as such', async () => {
  stubGuideDownload(currentGuide());
  const { gladys, integration } = setup();
  gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  await integration.onConnected();
  assert.deepEqual(lastStatus(gladys), {
    connected: false,
    message: STATUS_MESSAGES[STATUS.STATES_REFUSED],
  });
});

test('the refresh loop reports an outdated guide', async () => {
  // The fixture's programmes have all ended (2026-09-29 and 2000-01-01).
  stubGuideDownload();
  const { gladys, integration } = setup();
  await integration.refreshCycle();
  assert.deepEqual(lastStatus(gladys), {
    connected: false,
    message: STATUS_MESSAGES[STATUS.GUIDE_OUTDATED],
  });
});

test('the refresh loop reports the status, not only the connection', async () => {
  stubFetch(() => new Response(null, { status: 503 }));
  const { gladys, integration } = setup();
  await integration.refreshCycle(); // never throws: it runs in a timer
  assert.equal(lastStatus(gladys).message, STATUS_MESSAGES[STATUS.GUIDE_UNAVAILABLE]);

  resetGuideCache(); // past the retry delay
  stubGuideDownload(currentGuide());
  await integration.refreshCycle();
  assert.deepEqual(lastStatus(gladys), { connected: true, message: undefined });
  assert.equal(gladys.connectionStatuses.length, 2, 'one status per change');
});

test('a poll publishes the channel once a minute, and fails with the guide', async () => {
  stubGuideDownload(currentGuide());
  const { gladys, integration } = setup();
  const [device] = gladys.devices;
  await integration.onPoll(device);
  await integration.onPoll(device); // within the minute: nothing new
  assert.equal(gladys.published.length, 3);
  await integration.onPoll({ external_id: 'unknown' });
  assert.equal(gladys.published.length, 3);

  resetGuideCache();
  stubFetch(() => new Response(null, { status: 503 }));
  const other = setup();
  await assert.rejects(() => other.integration.onPoll(other.gladys.devices[0]), /HTTP 503/);
  assert.equal(lastStatus(other.gladys).message, STATUS_MESSAGES[STATUS.GUIDE_UNAVAILABLE]);
});

test('register wires every handler, and a disconnection stops the timers', () => {
  const { gladys, integration, watcher } = setup();
  integration.register();
  for (const key of [
    'scanRequest',
    'poll',
    'configUpdated',
    'action:test_guide',
    'widget:tv_guide',
    'sceneAction:get_programme',
    'event:connected',
    'event:disconnected',
  ]) {
    assert.equal(typeof gladys.handlers[key], 'function', key);
  }
  gladys.handlers['event:disconnected']();
  assert.equal(watcher.stops, 1);
});

test('a rejected first connection is logged, never fatal', async () => {
  const { gladys, integration } = setup();
  gladys.connect = async () => {
    throw new Error('GladysIntegration: authentication refused by Gladys (close code 4000)');
  };
  const realExit = process.exit;
  let exited = false;
  process.exit = () => {
    exited = true;
  };
  try {
    await integration.start();
  } finally {
    process.exit = realExit;
  }
  assert.equal(exited, false);
});
