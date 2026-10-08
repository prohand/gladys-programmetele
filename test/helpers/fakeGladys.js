// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishStates                  -> record calls so tests can assert them
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
