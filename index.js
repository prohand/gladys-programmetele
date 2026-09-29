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
import { normalizeConfig } from './src/config.js';
import { getGuide } from './src/guide.js';
import {
  ACTIONS,
  buildDiscoveredDevices,
  findChannelByDevice,
  selectedChannels,
} from './src/devices/index.js';
import { tvChannel } from './src/devices/tvChannel.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Last connection status sent to Gladys (avoid sending the same one again).
let lastStatus = null;

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
});

// --- Polling: Gladys asks to refresh a device --------------------------------
// Called every `poll_frequency` seconds for each created channel device.
gladys.onPoll(async (device) => {
  const channel = findChannelByDevice(gladys, device);
  if (!channel) {
    logger.debug(`onPoll ignored (unknown device) for ${device.external_id}`);
    return;
  }
  try {
    await tvChannel.onPoll(gladys, channel);
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

    // 3) Fill the sensors right away, without waiting for the first poll.
    await refreshCreatedDevices();

    // 4) Report the application-level status, shown in the Configuration
    // screen.
    lastStatus = null;
    await reportStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    lastStatus = null;
    await reportStatus(false);
  }
});

// Publish the programmes of every channel device already created in Gladys.
async function refreshCreatedDevices() {
  const created = new Set(gladys.devices.map((device) => device.external_id));
  const channels = selectedChannels(config).filter((channel) =>
    created.has(tvChannel.deviceExternalId(gladys, channel)),
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
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Programme Télé integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
