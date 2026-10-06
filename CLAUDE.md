# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 20+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) that shows the French TV guide (TNT channels):
what is on air now, what comes next, and tonight's programme. It runs as a container next to
Gladys and talks to it over the SDK's WebSocket. No HTTP server, no database: the guide lives in
memory.

Data source: the free XMLTV feed of xmltvfr.fr (`xmltv_tnt.xml.gz`, ~1 MB, 30 channels, ~8 days).
No account, no key.

## Commands

```bash
npm install
npm test                                   # node --test (built-in runner, no framework)
node --test test/guide.test.js             # one file
node --test --test-name-pattern "tonight"  # one test by name
npm run lint                               # eslint .
npm run format:check                       # prettier --check . (CI gate)
npm run format                             # prettier --write .

# run against a local Gladys
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="programme-tele" \
LOG_LEVEL=debug npm start
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test`. Run the three before
pushing. Releases go through **Actions → Release** (bumps `package.json`, the manifest `version`
and `docker_image`, tags `vX.Y.Z`, calls `build.yml`): never bump versions by hand.

## Architecture

```
index.js                  SDK wiring only: handlers registered BEFORE connect()
src/config.js             defaults + normalization (channels list, fixed poll frequency)
src/channels.js           the 30 TNT channels (XMLTV id + display name)
src/guide.js              download, cache and parse the XMLTV feed; schedule helpers
src/devices/index.js      registry: one device per selected channel + manifest actions
src/devices/tvChannel.js  the "TV channel" device: 3 read-only text features
src/widget.js             dashboard widget `tv_guide` (Gladys 5.1)
src/scenes.js             scene trigger `programme_started` + scene action `get_programme`
```

### Invariants worth knowing

- **The guide is downloaded once and shared.** `getGuide()` keeps the parsed guide for 6 h
  (`GUIDE_MAX_AGE_MS`), waits 15 min after a failure (`GUIDE_RETRY_DELAY_MS`) while serving the
  old guide, and shares one in-flight promise so ten devices polled together cost one download.
  Never call `downloadGuide()` from a device, widget or scene path.
- **Times are French times.** Display and "tonight" (21:10, `PRIME_TIME`) are computed in
  `Europe/Paris` through `Intl.DateTimeFormat`, whatever the container time zone. XMLTV dates are
  parsed with their own offset (`parseXmltvDate`).
- **No XML library.** The XMLTV format is read with regular expressions (`parseXmltv`); entities
  are decoded by `decodeEntities`. Keep it dependency-free.
- **Device identity = XMLTV channel id** (`ext:<selector>:tv-channel:TF1.fr`). `findChannelByDevice`
  searches ALL channels, so a device whose channel was unticked still resolves.
- **`poll_frequency` is fixed at 60 000 ms** (`POLL_FREQUENCY`) and is not a config field: Gladys
  only accepts 1 s / 2 s / 10 s / 15 s / 30 s / 60 s and rejects the whole discovery otherwise.
  Gladys only schedules a device whose row also carries `should_poll: true` (default `false` in
  the core).
- **Every feature declares `min`/`max`** (`0`/`0` for text): they are NOT NULL in Gladys.
- **Text states are capped** at 250 characters (`MAX_TEXT_LENGTH`), event strings at 1000.
- **Scene trigger = transition.** The watcher checks every minute for programmes that started
  since the last check, never replays the past on its first check, and catches up at most 5 min
  after a pause (`MAX_CATCH_UP_MS`). A refused event never hides the others.
- **Keys are forever**: widget, trigger, action, field, variable and output keys are stored in
  users' dashboards and scenes. Add, never rename.

### Manifest

`gladys-assistant-integration.json` declares the `channels` multi-select, the `test_guide` action,
the widget and the scene declarations (`gladys_version >=5.1.0`). `test/manifest.test.js` keeps it
in sync with `DEFAULT_CONFIG`, `ACTIONS`, `CHANNELS` and the scene/widget keys. Change both sides
together. The Release workflow rewrites the manifest with `jq`: run `npm run format` afterwards or
CI fails on formatting.

## Testing

Tests never hit the network: `test/fixtures/guide.xml` is a small XMLTV file, `globalThis.fetch`
is stubbed where needed, and `resetGuideCache()` must be called between tests that download (the
cache is module-level). `test/helpers/fakeGladys.js` stands in for the SDK.

## Conventions

- Prettier owns formatting (`.prettierrc.json`); ESLint catches real mistakes.
- Comments explain **why**, in English. User-facing strings (action results, statuses, widget
  texts) are bilingual `{ en, fr }`; device and feature names are French.
- User docs live in `docs/fr.md` and `docs/en.md` (re-hosted by Gladys): keep both in sync.
- The rootfs is read-only in the Gladys sandbox: do not write files.
