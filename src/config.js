// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

import { findChannel } from './channels.js';

// Refresh intervals offered to the user, in MILLISECONDS. Gladys only accepts
// a few values for a device `poll_frequency` (DEVICE_POLL_FREQUENCIES of the
// core: 1 s, 2 s, 10 s, 15 s, 30 s, 1 min) and rejects the whole discovery
// otherwise. 1 min is the slowest; faster is useless for a TV guide below 10 s.
// Same values as the `poll_frequency` options of the manifest.
export const POLL_FREQUENCIES = [60_000, 30_000, 15_000, 10_000];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  // XMLTV ids of the channels to follow (one Gladys device per channel).
  channels: ['TF1.fr', 'France2.fr', 'France3.fr', 'France5.fr', 'M6.fr', 'Arte.fr'],
  // Milliseconds between two refreshes of the "now / next / tonight" sensors.
  poll_frequency: 60_000,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    channels: normalizeChannels(raw.channels),
    poll_frequency: normalizePollFrequency(raw.poll_frequency),
  };
}

// `multi_select` stores an array of option values. Also accept a
// comma-separated string, drop unknown ids and duplicates.
function normalizeChannels(value) {
  if (value === undefined || value === null) {
    return [...DEFAULT_CONFIG.channels];
  }
  const list = Array.isArray(value) ? value : String(value).split(',');
  const ids = list.map((id) => String(id).trim()).filter((id) => findChannel(id));
  return [...new Set(ids)];
}

// The select stores a string: force a number. A value given in seconds
// (e.g. 30) is converted; anything Gladys would refuse (e.g. 300 saved by the
// first version) falls back to the default.
function normalizePollFrequency(value) {
  const number = Number(value ?? DEFAULT_CONFIG.poll_frequency);
  if (POLL_FREQUENCIES.includes(number)) {
    return number;
  }
  if (POLL_FREQUENCIES.includes(number * 1000)) {
    return number * 1000;
  }
  return DEFAULT_CONFIG.poll_frequency;
}
