// -----------------------------------------------------------------------------
// Device type: TV CHANNEL
// One device per channel chosen by the user, with 3 read-only text sensors:
//   - "En cours"  : the programme on air now;
//   - "À suivre"  : the next programme;
//   - "Ce soir"   : tonight's programme (on air at 21:10, French time).
// Values are refreshed every minute by src/integration.js (the core's poll and
// the integration's own loop), from one shared guide.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { findSchedule, formatCurrent, formatUpcoming } from '../guide.js';

const DEVICE_TYPE = 'tv-channel';

// Feature keys, kept in one place so discovery and polling always agree.
export const FEATURE = {
  CURRENT: 'current',
  NEXT: 'next',
  TONIGHT: 'tonight',
};

const FEATURE_NAMES = {
  [FEATURE.CURRENT]: 'En cours',
  [FEATURE.NEXT]: 'À suivre',
  [FEATURE.TONIGHT]: 'Ce soir',
};

function textFeature(ids, key) {
  return {
    name: FEATURE_NAMES[key],
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    read_only: true, // sensor: no action possible
    has_feedback: false,
    keep_history: false,
  };
}

export const tvChannel = {
  key: DEVICE_TYPE,

  // The XMLTV channel id is the unique and stable platform id.
  deviceExternalId(gladys, channel) {
    return gladys.externalIds(DEVICE_TYPE, channel.id).device;
  },

  buildDevice(gladys, channel, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, channel.id);
    return {
      name: `Programme TV ${channel.name}`,
      external_id: ids.device,
      // Gladys will call onPoll at this interval (in MILLISECONDS, see
      // POLL_FREQUENCY in src/config.js).
      poll_frequency: config.poll_frequency,
      // Gladys only schedules a device that also asks for it: `should_poll`
      // is false by default in the core, and without it the sensors were
      // never refreshed. The core reads the flag once, at creation: devices
      // created before it are refreshed by the integration's own loop
      // (index.js).
      should_poll: true,
      features: [
        textFeature(ids, FEATURE.CURRENT),
        textFeature(ids, FEATURE.NEXT),
        textFeature(ids, FEATURE.TONIGHT),
      ],
    };
  },

  /**
   * Build the 3 text states of a channel, from the guide.
   */
  buildStates(gladys, channel, guide, now = new Date()) {
    const ids = gladys.externalIds(DEVICE_TYPE, channel.id);
    const { current, next, tonight } = findSchedule(guide, channel.id, now);
    return [
      { device_feature_external_id: ids.feature(FEATURE.CURRENT), text: formatCurrent(current) },
      { device_feature_external_id: ids.feature(FEATURE.NEXT), text: formatUpcoming(next) },
      { device_feature_external_id: ids.feature(FEATURE.TONIGHT), text: formatUpcoming(tonight) },
    ];
  },
};
