import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG, POLL_FREQUENCIES } from '../src/config.js';

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

test('poll_frequency: the select string is coerced to a number of milliseconds', () => {
  const config = normalizeConfig({ poll_frequency: '30000' });
  assert.equal(config.poll_frequency, 30_000);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('poll_frequency: a value in seconds is converted', () => {
  assert.equal(normalizeConfig({ poll_frequency: 15 }).poll_frequency, 15_000);
});

test('poll_frequency: always one of the values Gladys accepts', () => {
  // 300 = the value saved by the first version (seconds, refused by Gladys).
  for (const value of [300, 5, 99999, 1000, '120']) {
    assert.ok(POLL_FREQUENCIES.includes(normalizeConfig({ poll_frequency: value }).poll_frequency));
  }
  assert.equal(normalizeConfig({ poll_frequency: 300 }).poll_frequency, 60_000);
});

test('poll_frequency: missing or invalid value falls back to the default', () => {
  assert.equal(normalizeConfig({}).poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(
    normalizeConfig({ poll_frequency: 'abc' }).poll_frequency,
    DEFAULT_CONFIG.poll_frequency,
  );
});
