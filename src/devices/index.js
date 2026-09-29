// -----------------------------------------------------------------------------
// Device registry.
//
// The devices are the TV channels selected by the user in the configuration
// (`channels` field): one `tvChannel` device per channel.
// -----------------------------------------------------------------------------

import { CHANNELS, findChannel } from '../channels.js';
import { findSchedule, formatCurrent, getGuide } from '../guide.js';
import { tvChannel } from './tvChannel.js';

/**
 * Channels selected in the configuration.
 */
export function selectedChannels(config) {
  return config.channels.map(findChannel).filter(Boolean);
}

/**
 * Build the discovery payload for Gladys (one device per selected channel).
 */
export function buildDiscoveredDevices(gladys, config) {
  return selectedChannels(config).map((channel) => tvChannel.buildDevice(gladys, channel, config));
}

/**
 * Find the channel of a device, from its external_id (used to route onPoll).
 * Search in ALL the channels: a device created before the user removed its
 * channel from the configuration is still known.
 */
export function findChannelByDevice(gladys, device) {
  return CHANNELS.find(
    (channel) => tvChannel.deviceExternalId(gladys, channel) === device.external_id,
  );
}

/**
 * Handlers of the manifest actions (see the `actions` field of
 * gladys-assistant-integration.json), keyed by action `key`.
 */
export const ACTIONS = {
  // Download the guide now and show what is on air on the first channel.
  async test_guide(gladys, { config }) {
    const guide = await getGuide({ force: true });
    const [channel = CHANNELS[0]] = selectedChannels(config);
    const { current } = findSchedule(guide, channel.id);
    return {
      en: `TV guide OK (${guide.size} channels). Now on ${channel.name}: ${formatCurrent(current)}`,
      fr: `Guide TV OK (${guide.size} chaînes). En ce moment sur ${channel.name} : ${formatCurrent(current)}`,
    };
  },
};
