import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildWidgetContent, MAX_ITEMS, MOMENT, widgetChannels } from '../src/widget.js';
import { parseXmltv } from '../src/guide.js';
import { normalizeConfig } from '../src/config.js';
import { CHANNELS } from '../src/channels.js';

const guide = parseXmltv(await readFile(new URL('./fixtures/guide.xml', import.meta.url), 'utf8'));
const config = normalizeConfig({ channels: ['TF1.fr', 'M6.fr'] });
const now = new Date('2026-09-29T18:00:00Z'); // 20:00 in Paris

test('widgetChannels: own setting first, else the integration channels', () => {
  assert.deepEqual(
    widgetChannels({ channels: ['Arte.fr'] }, config).map((c) => c.id),
    ['Arte.fr'],
  );
  assert.deepEqual(
    widgetChannels({ channels: [] }, config).map((c) => c.id),
    ['TF1.fr', 'M6.fr'],
  );
  assert.deepEqual(
    widgetChannels(undefined, config).map((c) => c.id),
    ['TF1.fr', 'M6.fr'],
  );
});

test('"now" lists the programme on air with the time left', () => {
  const content = buildWidgetContent(guide, { settings: {}, language: 'fr', config, now });
  assert.deepEqual(validateWidgetContent(content), []);
  const [list] = content.components;
  assert.equal(list.type, 'card-list');
  assert.deepEqual(list.items[0], {
    title: 'Journal de 20H',
    subtitle: 'TF1 · 19:45 - 20:10',
    badge: { text: 'encore 10 min', color: 'primary' },
    description: 'Information',
  });
  assert.equal(list.items[1].title, 'Météo');
  // Pulled again when the first programme ends (20:10 = 600 s).
  assert.equal(content.ttl_seconds, 600);
});

test('"tonight" lists the 21:10 programme with its description', () => {
  const content = buildWidgetContent(guide, {
    settings: { moment: MOMENT.TONIGHT },
    language: 'en',
    config,
    now,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const [tf1, m6] = content.components[0].items;
  assert.equal(tf1.title, 'Grand film');
  assert.deepEqual(tf1.badge, { text: '21:10', color: 'info' });
  assert.equal(tf1.description, 'Film\nUn film pour toute la famille.');
  assert.deepEqual(m6, { title: 'No programme', subtitle: 'M6' });
});

test('more than 8 channels: 8 rows and a caption', () => {
  const all = normalizeConfig({ channels: CHANNELS.map((c) => c.id) });
  const content = buildWidgetContent(guide, { config: all, now, language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].items.length, MAX_ITEMS);
  assert.match(content.components[1].text, /\+22 autre/);
});

test('no channel: a valid text explains what to do', () => {
  const content = buildWidgetContent(guide, { config: normalizeConfig({ channels: [] }), now });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});
