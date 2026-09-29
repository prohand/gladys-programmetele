// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/devices/index.js';
import { CHANNELS } from '../src/channels.js';
import { DEFAULT_CONFIG, POLL_FREQUENCY_MAX, POLL_FREQUENCY_MIN } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const field = (key) => manifest.config_schema.find((f) => f.key === key);

test('every manifest action has a registered handler, and the other way round', () => {
  const declared = (manifest.actions ?? []).map((a) => a.key).sort();
  assert.deepEqual(declared, Object.keys(ACTIONS).sort());
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(major > 4 || (major === 4 && minor >= 86));
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const f of manifest.config_schema) {
    if (f.default !== undefined) {
      assert.deepEqual(DEFAULT_CONFIG[f.key], f.default, `DEFAULT_CONFIG.${f.key} must match`);
    }
  }
});

test('the poll_frequency field matches the code bounds', () => {
  const poll = field('poll_frequency');
  assert.equal(poll.type, 'number');
  assert.equal(poll.min, POLL_FREQUENCY_MIN);
  assert.equal(poll.max, POLL_FREQUENCY_MAX);
});

test('the channels options are exactly the known channels', () => {
  const channels = field('channels');
  assert.equal(channels.type, 'multi_select');
  assert.deepEqual(
    channels.options.map((o) => o.value),
    CHANNELS.map((c) => c.id),
  );
  const values = new Set(channels.options.map((o) => o.value));
  assert.ok(
    channels.default.every((id) => values.has(id)),
    'defaults must be valid options',
  );
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(section.label?.en);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});
