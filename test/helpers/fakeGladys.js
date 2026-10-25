// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishStates                  -> record calls so tests can assert them
//   - publishChangedStates           -> the SDK's dedupe (same value skipped,
//                                       re-sent past `heartbeat`), then
//                                       publishStates; forgetPublishedStates
//   - setConnectionStatus            -> record calls so tests can assert them
//   - publishSceneEvent              -> record calls so tests can assert them
//   - requestWidgetRefresh           -> record calls so tests can assert them
//   - publishDiscoveredDevices       -> record calls so tests can assert them
//   - on* / on(event)                -> keep the handlers registered by
//                                       src/integration.js in `handlers`
//   - config, devices                -> the state the SDK resynchronizes
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys() {
  const published = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  const discovered = [];
  const handlers = {};
  // Last value accepted per feature, as the SDK remembers it.
  const lastPublished = new Map();

  return {
    published,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,
    discovered,
    handlers,
    devices: [],
    config: {},

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.state,
          text: s.text,
        });
      }
    },

    async publishChangedStates(states, { heartbeat } = {}) {
      const now = Date.now();
      const changed = states.filter((s) => {
        const last = lastPublished.get(s.device_feature_external_id);
        if (!last || last.state !== s.state || last.text !== s.text) {
          return true;
        }
        return heartbeat !== undefined && now - last.at >= heartbeat;
      });
      if (changed.length > 0) {
        // Remembered only once accepted: a refusal throws and is sent again.
        await this.publishStates(changed);
        for (const s of changed) {
          lastPublished.set(s.device_feature_external_id, {
            state: s.state,
            text: s.text,
            at: now,
          });
        }
      }
      return { success: true, count: changed.length };
    },

    forgetPublishedStates(externalId) {
      if (externalId === undefined) {
        lastPublished.clear();
        return;
      }
      for (const key of [...lastPublished.keys()]) {
        if (key === externalId || key.startsWith(`${externalId}:`)) {
          lastPublished.delete(key);
        }
      }
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(devices);
    },

    onScanRequest: (cb) => (handlers.scanRequest = cb),
    onPoll: (cb) => (handlers.poll = cb),
    onAction: (key, cb) => (handlers[`action:${key}`] = cb),
    onWidgetGet: (key, cb) => (handlers[`widget:${key}`] = cb),
    onSceneAction: (key, cb) => (handlers[`sceneAction:${key}`] = cb),
    onConfigUpdated: (cb) => (handlers.configUpdated = cb),
    on: (event, cb) => (handlers[`event:${event}`] = cb),
  };
}
