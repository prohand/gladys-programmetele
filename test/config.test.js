import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG, POLL_FREQUENCY } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps the selected channels, drops unknown ones and duplicates', () => {
  const config = normalizeConfig({ channels: ['M6.fr', 'Nope.fr', 'M6.fr', 'Arte.fr'] });
  assert.deepEqual(config.channels, ['M6.fr', 'Arte.fr']);
});

test('normalizeConfig accepts a comma-separated channel list', () => {
  assert.deepEqual(normalizeConfig({ channels: 'TF1.fr, M6.fr' }).channels, ['TF1.fr', 'M6.fr']);
});

test('normalizeConfig allows an empty channel list', () => {
  assert.deepEqual(normalizeConfig({ channels: [] }).channels, []);
});

test('poll_frequency: always 1 min, whatever was saved by an older version', () => {
  // 300 = the value saved by the first version (seconds, refused by Gladys).
  for (const value of [undefined, '30000', 15, 300, 'abc']) {
    assert.equal(normalizeConfig({ poll_frequency: value }).poll_frequency, POLL_FREQUENCY);
  }
  assert.equal(POLL_FREQUENCY, 60_000);
});
