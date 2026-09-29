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

// Bounds of the refresh interval, same as the manifest `min` / `max`.
export const POLL_FREQUENCY_MIN = 60;
export const POLL_FREQUENCY_MAX = 3600;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  // XMLTV ids of the channels to follow (one Gladys device per channel).
  channels: ['TF1.fr', 'France2.fr', 'France3.fr', 'France5.fr', 'M6.fr', 'Arte.fr'],
  // Seconds between two refreshes of the "now / next / tonight" sensors.
  poll_frequency: 300,
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

// Config may arrive as a string from a form: force a number, fall back to the
// default when it is not a number, and keep it inside the manifest bounds.
function normalizePollFrequency(value) {
  const seconds = Number(value ?? DEFAULT_CONFIG.poll_frequency);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_CONFIG.poll_frequency;
  }
  return Math.min(POLL_FREQUENCY_MAX, Math.max(POLL_FREQUENCY_MIN, Math.round(seconds)));
}
