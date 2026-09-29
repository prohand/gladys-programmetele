import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/config.js';

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

test('poll_frequency: string from a form is coerced to a number', () => {
  const config = normalizeConfig({ poll_frequency: '600' });
  assert.equal(config.poll_frequency, 600);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('poll_frequency: missing or invalid value falls back to the default', () => {
  assert.equal(normalizeConfig({}).poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(
    normalizeConfig({ poll_frequency: 'abc' }).poll_frequency,
    DEFAULT_CONFIG.poll_frequency,
  );
});

test('poll_frequency: kept inside the manifest bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
});
