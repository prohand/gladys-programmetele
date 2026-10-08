// -----------------------------------------------------------------------------
// Device registry.
//
// The devices are the TV channels selected by the user in the configuration
// (`channels` field): one `tvChannel` device per channel.
// -----------------------------------------------------------------------------

import { CHANNELS, findChannel } from '../channels.js';
import {
  findSchedule,
  formatCurrent,
  formatDateTime,
  getGuide,
  guideInfo,
  isGuideOutdated,
} from '../guide.js';
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
  // Download the guide now and show what is on air on the first channel. A
  // failed download is RETURNED, not thrown: the SDK would ack a thrown error
  // as a plain English string.
  async test_guide(gladys, { config }) {
    let guide;
    try {
      guide = await getGuide({ force: true });
    } catch (err) {
      return downloadFailedMessage(err);
    }
    const [channel = CHANNELS[0]] = selectedChannels(config);
    const { current } = findSchedule(guide, channel.id);
    return {
      en: `TV guide OK (${guide.size} channels). Now on ${channel.name}: ${formatCurrent(current)}`,
      fr: `Guide TV OK (${guide.size} chaînes). En ce moment sur ${channel.name} : ${formatCurrent(current)}`,
    };
  },
};

// The download failed: say so, and say what is shown meanwhile.
function downloadFailedMessage(err) {
  const failed = {
    en: `TV guide download failed (${err.message}).`,
    fr: `Échec du téléchargement du guide TV (${err.message}).`,
  };
  const info = guideInfo();
  if (!info) {
    return {
      en: `${failed.en} No guide available yet: a new try is made automatically in a few minutes.`,
      fr: `${failed.fr} Aucun guide disponible pour l'instant : un nouvel essai est fait automatiquement dans quelques minutes.`,
    };
  }
  const fetchedAt = formatDateTime(info.fetchedAt);
  const until = formatDateTime(info.coversUntil);
  if (isGuideOutdated()) {
    return {
      en: `${failed.en} The previous guide (downloaded ${fetchedAt}) has ended on ${until}: nothing left to show.`,
      fr: `${failed.fr} L'ancien guide (téléchargé le ${fetchedAt}) s'est terminé le ${until} : plus rien à afficher.`,
    };
  }
  return {
    en: `${failed.en} The previous guide (downloaded ${fetchedAt}, programmes until ${until}) is still used.`,
    fr: `${failed.fr} L'ancien guide (téléchargé le ${fetchedAt}, programmes jusqu'au ${until}) reste utilisé.`,
  };
}
