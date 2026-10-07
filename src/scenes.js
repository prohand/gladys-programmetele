// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers` / `scene_actions`).
//
// - Trigger `programme_started`: fired once when a programme starts, on any of
//   the guide channels. The scene author filters by channel and exact title.
// - Action `get_programme`: returns the now / next / tonight programmes of a
//   channel to the following actions of the scene.
//
// Keys (trigger, action, fields, variables, outputs) are stored by the scenes:
// never rename them once published.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { findChannel } from './channels.js';
import {
  findSchedule,
  findStartedProgrammes,
  formatCurrent,
  formatTime,
  formatUpcoming,
  getGuide,
} from './guide.js';

const logger = createLogger({ name: 'scenes' });

export const TRIGGER_PROGRAMME_STARTED = 'programme_started';
export const ACTION_GET_PROGRAMME = 'get_programme';

// How often the watcher looks for programmes that just started.
export const WATCH_INTERVAL_MS = 60 * 1000;
// After a pause (disconnection, slow download), do not fire programmes that
// started more than this long ago: the event would come too late.
export const MAX_CATCH_UP_MS = 5 * 60 * 1000;

// Event strings are capped at 1000 characters by the core.
const MAX_EVENT_STRING = 1000;
const cap = (text) => (text ? String(text).slice(0, MAX_EVENT_STRING) : null);

/**
 * Flat data of a `programme_started` event. Keys match the manifest trigger
 * `fields` (filters) and `variables` (exposed to the scene).
 */
export function buildStartedEvent(channelId, programme) {
  const channel = findChannel(channelId);
  return {
    channel: channelId,
    channel_name: channel?.name ?? channelId,
    title: cap(programme.title),
    sub_title: cap(programme.subTitle),
    category: cap(programme.category),
    start: formatTime(programme.start),
    stop: formatTime(programme.stop),
    duration_minutes: Math.round((programme.stop - programme.start) / 60_000),
  };
}

/**
 * Watch the guide and fire `programme_started` for each programme that starts.
 * @param {object} gladys SDK instance
 * @param {{ onStarted?: (events: object[]) => void }} [options] called after a
 *   check that fired at least one event (used to refresh the widget)
 */
export function createProgrammeWatcher(gladys, { onStarted } = {}) {
  let timer = null;
  let lastCheck = null;

  async function check(now = new Date()) {
    if (lastCheck === null) {
      // First check: start from now, never replay the past.
      lastCheck = now;
      return [];
    }
    const previous = lastCheck;
    const from = new Date(Math.max(previous.getTime(), now.getTime() - MAX_CATCH_UP_MS));
    // Moved forward BEFORE waiting for the guide: a check still waiting for a
    // download when the next one starts must not hand it the same window, or
    // every programme in it would fire twice.
    lastCheck = now;
    let guide;
    try {
      guide = await getGuide({ now: now.getTime() });
    } catch (err) {
      // No guide at all: give the window back, the next check catches it up.
      if (lastCheck === now) {
        lastCheck = previous;
      }
      throw err;
    }
    const events = findStartedProgrammes(guide, from, now).map(({ channelId, programme }) =>
      buildStartedEvent(channelId, programme),
    );
    for (const event of events) {
      logger.debug(`programme_started -> ${event.channel_name}: ${event.title}`);
      try {
        await gladys.publishSceneEvent(TRIGGER_PROGRAMME_STARTED, event);
      } catch (err) {
        // One refused event must not hide the others.
        logger.error(`programme_started refused for ${event.channel_name}`, err);
      }
    }
    if (events.length > 0) {
      onStarted?.(events);
    }
    return events;
  }

  return {
    check,
    start() {
      this.stop();
      lastCheck = null;
      check().catch(() => {});
      timer = setInterval(() => {
        check().catch((err) => logger.error('Programme watcher check failed', err));
      }, WATCH_INTERVAL_MS);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/**
 * Handler of the `get_programme` scene action.
 * @param {{ channel: string }} fields resolved by the core
 * @returns {Promise<object>} the outputs declared in the manifest
 */
export async function getProgrammeAction(fields, now = new Date()) {
  const channel = findChannel(fields?.channel);
  if (!channel) {
    throw new Error(`Unknown channel "${fields?.channel}"`);
  }
  const guide = await getGuide({ now: now.getTime() });
  const { current, next, tonight } = findSchedule(guide, channel.id, now);
  return {
    channel_name: channel.name,
    current: formatCurrent(current),
    current_title: current?.title ?? '',
    next: formatUpcoming(next),
    next_title: next?.title ?? '',
    next_start: next ? formatTime(next.start) : '',
    tonight: formatUpcoming(tonight),
    tonight_title: tonight?.title ?? '',
    tonight_start: tonight ? formatTime(tonight.start) : '',
  };
}
