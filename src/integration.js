// -----------------------------------------------------------------------------
// Lifecycle of the integration: the SDK handlers, the refresh of the channel
// sensors, and the status shown in the Configuration screen.
//
// Kept out of index.js so it can be tested with the fake SDK: index.js builds
// the real one, which needs a Gladys host, at import time.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, POLL_FREQUENCY } from './config.js';
import { getGuide, isGuideOutdated } from './guide.js';
import {
  ACTIONS,
  buildDiscoveredDevices,
  findChannelByDevice,
  selectedChannels,
} from './devices/index.js';
import { tvChannel } from './devices/tvChannel.js';
import { ACTION_GET_PROGRAMME, createProgrammeWatcher, getProgrammeAction } from './scenes.js';
import { getTvGuideWidget, WIDGET_TV_GUIDE } from './widget.js';

const logger = createLogger({ name: 'integration' });

// What the Configuration screen shows. Each failure has its own message: a
// guide that cannot be downloaded and devices refused by Gladys are fixed in
// different places.
export const STATUS = {
  OK: 'ok',
  GUIDE_UNAVAILABLE: 'guide_unavailable',
  GUIDE_OUTDATED: 'guide_outdated',
  DEVICES_REFUSED: 'devices_refused',
  STATES_REFUSED: 'states_refused',
};

export const STATUS_MESSAGES = {
  [STATUS.GUIDE_UNAVAILABLE]: {
    en: 'Cannot download the TV guide, check the integration logs.',
    fr: 'Impossible de télécharger le programme TV, consultez les logs.',
  },
  [STATUS.GUIDE_OUTDATED]: {
    en: 'The TV guide is out of date: its last programmes have ended and no newer guide could be downloaded. Check the integration logs.',
    fr: "Le programme TV est périmé : ses derniers programmes sont terminés et aucun programme plus récent n'a pu être téléchargé. Consultez les logs.",
  },
  [STATUS.DEVICES_REFUSED]: {
    en: 'Gladys refused the TV channel devices, check the integration logs.',
    fr: 'Gladys a refusé les appareils des chaînes, consultez les logs.',
  },
  [STATUS.STATES_REFUSED]: {
    en: 'Cannot send the programmes to Gladys, check the integration logs.',
    fr: "Impossible d'envoyer les programmes à Gladys, consultez les logs.",
  },
};

// Two paths refresh the channels — the core's poll and the integration's own
// loop below — and this gap keeps them to one publication a minute between
// them.
const MIN_REFRESH_GAP_MS = 50_000;

/**
 * Wire the integration to an SDK instance.
 * @param {object} gladys SDK instance (or the fake one of the tests)
 * @param {{ watcher?: { start(): void, stop(): void } }} [options]
 */
export function createIntegration(gladys, { watcher } = {}) {
  // Current configuration (hot-reloaded via onConfigUpdated).
  let config = normalizeConfig();
  // Last status sent to Gladys (avoid sending the same one again).
  let lastStatus = null;
  // The last publication of the discovered devices was refused: the refresh
  // loop tries again, and the status says so meanwhile.
  let devicesRefused = false;
  // Last publication of each channel (XMLTV id -> ms).
  const lastRefreshAt = new Map();
  let refreshTimer = null;

  // Fires the `programme_started` scene trigger every time a programme
  // starts, and asks the dashboard to re-pull the widget at that moment.
  const programmeWatcher =
    watcher ??
    createProgrammeWatcher(gladys, {
      onStarted: () => {
        try {
          gladys.requestWidgetRefresh(WIDGET_TV_GUIDE);
        } catch (err) {
          logger.debug('Widget refresh request failed', err);
        }
      },
    });

  const isDue = (channel, now = Date.now()) =>
    now - (lastRefreshAt.get(channel.id) ?? 0) >= MIN_REFRESH_GAP_MS;

  async function reportStatus(status) {
    if (lastStatus === status) {
      return;
    }
    lastStatus = status;
    const ok = status === STATUS.OK;
    await gladys
      .setConnectionStatus(ok, ok ? undefined : STATUS_MESSAGES[status])
      .catch((err) => logger.error('setConnectionStatus failed', err));
  }

  // The status once the guide is in hand and the states are published.
  function settledStatus() {
    if (isGuideOutdated()) {
      return STATUS.GUIDE_OUTDATED;
    }
    return devicesRefused ? STATUS.DEVICES_REFUSED : STATUS.OK;
  }

  // Publish the discovered devices. Never throws: a refusal is logged, kept
  // for the status, and retried by the refresh loop.
  async function publishDevices() {
    try {
      await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
      devicesRefused = false;
    } catch (err) {
      // The SDK swallows the errors of event handlers at debug level only.
      logger.error('Publishing the discovered devices failed', err);
      devicesRefused = true;
      await reportStatus(STATUS.DEVICES_REFUSED);
    }
  }

  // Publish the programmes of `channels`, and report the outcome as the
  // status. The guide is asked for even with no channel: the status then
  // still tells whether there is one. Throws what failed, once reported.
  async function refreshChannels(channels) {
    let guide;
    try {
      guide = await getGuide();
    } catch (err) {
      await reportStatus(STATUS.GUIDE_UNAVAILABLE);
      throw err;
    }
    try {
      // 3 states per channel: stay under the 100 states per request limit.
      const states = channels.flatMap((channel) => tvChannel.buildStates(gladys, channel, guide));
      for (let i = 0; i < states.length; i += 99) {
        await gladys.publishStates(states.slice(i, i + 99));
      }
    } catch (err) {
      await reportStatus(STATUS.STATES_REFUSED);
      throw err;
    }
    const now = Date.now();
    channels.forEach((channel) => lastRefreshAt.set(channel.id, now));
    await reportStatus(settledStatus());
  }

  // Publish the programmes of every channel device already created in Gladys.
  async function refreshCreatedDevices() {
    const created = new Set(gladys.devices.map((device) => device.external_id));
    const channels = selectedChannels(config).filter(
      (channel) => created.has(tvChannel.deviceExternalId(gladys, channel)) && isDue(channel),
    );
    await refreshChannels(channels);
  }

  // One cycle of the integration's own loop. Gladys only polls a device whose
  // row carries `should_poll: true`, read once when the device is created:
  // every channel created before that flag was published would stay frozen
  // forever without it. Never throws: it runs in a timer.
  async function refreshCycle() {
    try {
      if (devicesRefused) {
        await publishDevices();
      }
      await refreshCreatedDevices();
    } catch (err) {
      logger.error('Scheduled refresh failed', err);
    }
  }

  function startRefreshLoop() {
    if (refreshTimer) {
      return;
    }
    refreshTimer = setInterval(refreshCycle, POLL_FREQUENCY);
    refreshTimer.unref?.();
  }

  function stop() {
    programmeWatcher.stop();
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // --- Connection lifecycle --------------------------------------------------
  async function onConnected() {
    // Started FIRST, and outside of any try: both retry on their own every
    // minute, so neither a refused publication nor a failed download below
    // may keep them off until the next reconnection.
    programmeWatcher.start();
    startRefreshLoop();
    // A new connection: send the status again, whatever was sent before.
    lastStatus = null;
    // The SDK has just fetched the configuration (GET /config) and stored it
    // in `gladys.config`, right before emitting 'connected': no need to ask
    // for it a second time.
    config = normalizeConfig(gladys.config ?? {});
    await publishDevices();
    // Fill the sensors right away, without waiting for the first poll.
    try {
      await refreshCreatedDevices();
    } catch (err) {
      logger.error('Post-connection refresh failed', err);
    }
  }

  async function onPoll(device) {
    const channel = findChannelByDevice(gladys, device);
    if (!channel) {
      logger.debug(`onPoll ignored (unknown device) for ${device.external_id}`);
      return;
    }
    if (!isDue(channel)) {
      return;
    }
    try {
      await refreshChannels([channel]);
    } catch (err) {
      logger.error(`Refresh failed for ${channel.name}`, err);
      throw err;
    }
  }

  async function onConfigUpdated(newConfig) {
    logger.info('onConfigUpdated -> new configuration received');
    config = normalizeConfig(newConfig ?? {});
    // Re-publish the devices: the channel list depends on it.
    // publishDiscoveredDevices is idempotent (upsert by external_id).
    await publishDevices();
    await refreshCreatedDevices();
  }

  /** Register every handler. Call it once, BEFORE gladys.connect(). */
  function register() {
    // Discovery: Gladys asks for the list of devices.
    gladys.onScanRequest(async () => {
      logger.info('onScanRequest -> publishing discovered devices');
      await publishDevices();
    });
    // Polling: called every `poll_frequency` milliseconds for each created
    // channel device whose row carries `should_poll`.
    gladys.onPoll(onPoll);
    // Manifest actions: buttons in the Configuration screen.
    for (const [actionKey, handler] of Object.entries(ACTIONS)) {
      gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config }));
    }
    // Dashboard widget: Gladys pulls the content to display.
    gladys.onWidgetGet(WIDGET_TV_GUIDE, ({ settings, language }) =>
      getTvGuideWidget({ settings, language }, config),
    );
    // Scene action: a scene asks for the programme of a channel.
    gladys.onSceneAction(ACTION_GET_PROGRAMME, (fields) => getProgrammeAction(fields));
    gladys.onConfigUpdated(onConfigUpdated);
    // An EventEmitter does not wait for an async listener: catch here.
    gladys.on('connected', () => {
      onConnected().catch((err) => logger.error('Post-connection initialization failed', err));
    });
    gladys.on('disconnected', stop);
  }

  /**
   * Connect to Gladys. A rejection is logged, never fatal: the SDK keeps its
   * reconnection loop armed for life, including after a token refusal (close
   * code 4000, possibly transient while Gladys boots), and the supervisor
   * never recreates a container that exited on its own.
   */
  async function start() {
    try {
      await gladys.connect();
    } catch (err) {
      logger.error('Initial connection failed, the SDK keeps retrying', err);
    }
  }

  return {
    register,
    start,
    stop,
    onConnected,
    onPoll,
    onConfigUpdated,
    refreshCycle,
    get config() {
      return config;
    },
  };
}
