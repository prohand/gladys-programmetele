// -----------------------------------------------------------------------------
// Entry point of the "Programme Télé" Gladys external integration.
//
// Role of this file: wire the SDK to the device catalog (src/devices/). It holds
// NO TV guide logic (see src/guide.js and src/devices/tvChannel.js). It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects and publishes the discovered devices.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, POLL_FREQUENCY } from './src/config.js';
import { getGuide } from './src/guide.js';
import {
  ACTIONS,
  buildDiscoveredDevices,
  findChannelByDevice,
  selectedChannels,
} from './src/devices/index.js';
import { tvChannel } from './src/devices/tvChannel.js';
import { ACTION_GET_PROGRAMME, createProgrammeWatcher, getProgrammeAction } from './src/scenes.js';
import { getTvGuideWidget, WIDGET_TV_GUIDE } from './src/widget.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Last connection status sent to Gladys (avoid sending the same one again).
let lastStatus = null;

// Last publication of each channel (XMLTV id -> ms). Two paths refresh the
// channels — the core's poll and the integration's own loop below — and this
// keeps them to one publication a minute between them.
const lastRefreshAt = new Map();
const MIN_REFRESH_GAP_MS = 50_000;

const isDue = (channel, now = Date.now()) =>
  now - (lastRefreshAt.get(channel.id) ?? 0) >= MIN_REFRESH_GAP_MS;

// The integration's own refresh loop. Gladys only polls a device whose row
// carries `should_poll: true`, read once when the device is created: every
// channel created before that flag was published would stay frozen forever.
let refreshTimer = null;
function startRefreshLoop() {
  if (refreshTimer) {
    return;
  }
  refreshTimer = setInterval(() => {
    refreshCreatedDevices().catch((err) => logger.error('Scheduled refresh failed', err));
  }, POLL_FREQUENCY);
  refreshTimer.unref?.();
}
function stopRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Fires the `programme_started` scene trigger every time a programme starts,
// and asks the dashboard to re-pull the widget at that moment.
const watcher = createProgrammeWatcher(gladys, {
  onStarted: () => {
    try {
      gladys.requestWidgetRefresh(WIDGET_TV_GUIDE);
    } catch (err) {
      logger.debug('Widget refresh request failed', err);
    }
  },
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
});

// --- Polling: Gladys asks to refresh a device --------------------------------
// Called every `poll_frequency` milliseconds for each created channel device.
gladys.onPoll(async (device) => {
  const channel = findChannelByDevice(gladys, device);
  if (!channel) {
    logger.debug(`onPoll ignored (unknown device) for ${device.external_id}`);
    return;
  }
  if (!isDue(channel)) {
    return;
  }
  try {
    await tvChannel.onPoll(gladys, channel);
    lastRefreshAt.set(channel.id, Date.now());
    await reportStatus(true);
  } catch (err) {
    logger.error(`Refresh failed for ${channel.name}`, err);
    await reportStatus(false);
    throw err;
  }
});

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [actionKey, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config }));
}

// --- Dashboard widget: Gladys pulls the content to display -----------------
gladys.onWidgetGet(WIDGET_TV_GUIDE, ({ settings, language }) =>
  getTvGuideWidget({ settings, language }, config),
);

// --- Scene action: a scene asks for the programme of a channel --------------
gladys.onSceneAction(ACTION_GET_PROGRAMME, (fields) => getProgrammeAction(fields));

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Re-publish the devices: the channel list and the poll frequency depend on
  // it. publishDiscoveredDevices is idempotent (upsert by external_id).
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
  await refreshCreatedDevices();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) (Re)publish all devices as soon as we are connected.
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));

    // 3) Watch the programme starts (scene trigger). Started before the
    // guide download below, so a download failure does not stop it: the
    // watcher retries on its own every minute.
    watcher.start();
    startRefreshLoop();

    // 4) Fill the sensors right away, without waiting for the first poll.
    await refreshCreatedDevices();

    // 5) Report the application-level status, shown in the Configuration
    // screen.
    lastStatus = null;
    await reportStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    lastStatus = null;
    await reportStatus(false);
  }
});

gladys.on('disconnected', () => {
  watcher.stop();
  stopRefreshLoop();
});

// Publish the programmes of every channel device already created in Gladys.
async function refreshCreatedDevices() {
  const created = new Set(gladys.devices.map((device) => device.external_id));
  const channels = selectedChannels(config).filter(
    (channel) => created.has(tvChannel.deviceExternalId(gladys, channel)) && isDue(channel),
  );
  if (channels.length === 0) {
    return;
  }
  const guide = await getGuide();
  // 3 states per channel: stay under the 100 states per request limit.
  const states = channels.flatMap((channel) => tvChannel.buildStates(gladys, channel, guide));
  for (let i = 0; i < states.length; i += 99) {
    await gladys.publishStates(states.slice(i, i + 99));
  }
  const now = Date.now();
  channels.forEach((channel) => lastRefreshAt.set(channel.id, now));
}

async function reportStatus(connected) {
  if (lastStatus === connected) {
    return;
  }
  lastStatus = connected;
  await gladys
    .setConnectionStatus(
      connected,
      connected
        ? undefined
        : {
            en: 'Cannot download the TV guide, check the integration logs.',
            fr: 'Impossible de télécharger le programme TV, consultez les logs.',
          },
    )
    .catch((err) => logger.error('setConnectionStatus failed', err));
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  watcher.stop();
  stopRefreshLoop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Programme Télé integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
