# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [2.2.1] - 2026-10-08

### Changed

- The guide is downloaded with `If-None-Match` / `If-Modified-Since`: an unchanged feed costs a 304 instead of the whole file.
- The programme watcher checks at the start of every minute, so a scene fires seconds after a programme starts instead of up to a minute later.
- The connection status says what failed: guide unavailable, guide out of date, devices refused by Gladys, or programmes refused by Gladys. It is reported by every refresh, not only on connection.
- The configuration given by the SDK at connection is used as is, instead of being fetched a second time.
- Node 24 is required (`engines`), the version of the Docker image and of CI.
- Docker image: `npm ci --omit=dev --ignore-scripts` from the lockfile only, npm cache cleaned, no more `/data` volume (nothing is written). Dependabot also follows the `node:24-alpine` base image.

### Fixed

- A failed device publication on connection no longer leaves the programme watcher and the refresh loop off until the next reconnection; the loop publishes the devices again until Gladys accepts them.
- A truncated download (no closing `</tv>`) or a guide with fewer than half of the channels is refused, instead of replacing a good guide for 6 hours.
- With no guide yet, a failed download is retried after 2 minutes instead of several times a minute; the widget, the polls and the scenes fail at once meanwhile.
- The "Test the TV guide" button reports a failed download, and says whether the previous guide is still used, instead of showing "OK" with the old guide.
- Downloads are capped (20 MB received, 100 MB of XML once inflated, `Content-Length` checked first).
- An out-of-date guide (its last programme has ended while the source stays down) is now reported in the connection status.
- The widget shows a "TV guide unavailable" card that is pulled again a minute later, instead of the core's "data unavailable" until the dashboard is reloaded.
- An invalid numeric entity (`&#x110000;`) no longer makes the whole guide unreadable; CDATA sections are read.
- After a reconnection, the programmes started in the last 5 minutes fire their scene, as documented, instead of being skipped.
- A rejected first connection (token refusal, possibly transient while Gladys boots) is logged instead of exiting: the SDK keeps reconnecting.

## [2.2.0] - 2026-10-07

- Maintenance release, no functional change.

## [2.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.
- `CLAUDE.md`: guide for contributors and coding agents (commands, architecture, invariants).

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- Manifest re-formatted with Prettier, so the CI format check passes again.

### Fixed

- The channel sensors (now, next, tonight) are refreshed every minute again: devices are published with `should_poll: true`, without which Gladys never polls them, and an integration-owned loop refreshes the channels created before that flag.
- The Release workflow re-runs Prettier on the manifest after `jq`, so a release no longer leaves `main` with a failing CI format check.

## [2.0.0] - 2026-09-29

First public release.

### Added

- Intégration externe Gladys "Programme Télé"
- Widget, déclencheur et action de scène
- Intervalle de rafraîchissement fixé à 1 min, réglage retiré

### Changed

- Nouvelle image cover.png (téléviseur + grille des programmes)
- Cover.png compressée sous la limite de 150 Ko du store

### Fixed

- Poll_frequency en millisecondes, valeurs acceptées par Gladys

[Unreleased]: https://github.com/prohand/gladys-programmetele/compare/v2.2.1...HEAD
[2.2.1]: https://github.com/prohand/gladys-programmetele/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/prohand/gladys-programmetele/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/prohand/gladys-programmetele/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/prohand/gladys-programmetele/releases/tag/v2.0.0
