# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

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

[Unreleased]: https://github.com/prohand/gladys-programmetele/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/prohand/gladys-programmetele/releases/tag/v2.0.0
