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
import { DEFAULT_CONFIG, normalizeConfig, POLL_FREQUENCY } from '../src/config.js';
import { parseXmltv, resetGuideCache } from '../src/guide.js';
import { completeGuide, stubGuideDownload } from './helpers/guide.js';
import {
  ACTION_GET_PROGRAMME,
  buildStartedEvent,
  getProgrammeAction,
  TRIGGER_PROGRAMME_STARTED,
} from '../src/scenes.js';
import { MOMENT, WIDGET_TV_GUIDE } from '../src/widget.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const field = (key) => manifest.config_schema.find((f) => f.key === key);
const channelIds = CHANNELS.map((c) => c.id);

test('every manifest action has a registered handler, and the other way round', () => {
  const declared = (manifest.actions ?? []).map((a) => a.key).sort();
  assert.deepEqual(declared, Object.keys(ACTIONS).sort());
});

test('widgets and scene declarations require Gladys >= 5.1.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const f of manifest.config_schema) {
    if (f.default !== undefined) {
      // Compare after normalization: a select stores strings.
      assert.deepEqual(
        normalizeConfig({ [f.key]: f.default })[f.key],
        DEFAULT_CONFIG[f.key],
        `DEFAULT_CONFIG.${f.key} must match the manifest default`,
      );
    }
  }
});

// Values of DEVICE_POLL_FREQUENCIES in the Gladys core (server/utils/constants.js):
// any other device poll_frequency rejects the whole discovery (HTTP 400).
const GLADYS_POLL_FREQUENCIES = [1000, 2000, 10_000, 15_000, 30_000, 60_000];

test('poll_frequency is a value Gladys accepts, and is not configurable', () => {
  assert.equal(field('poll_frequency'), undefined);
  assert.ok(GLADYS_POLL_FREQUENCIES.includes(POLL_FREQUENCY));
  assert.equal(DEFAULT_CONFIG.poll_frequency, POLL_FREQUENCY);
});

test('every channel option list is exactly the known channels', () => {
  const lists = [
    field('channels'),
    ...manifest.widgets.flatMap((w) => w.settings),
    ...manifest.scene_triggers.flatMap((t) => t.fields),
    ...manifest.scene_actions.flatMap((a) => a.fields),
  ].filter((f) => f.key === 'channels' || f.key === 'channel');
  assert.equal(lists.length, 4);
  for (const f of lists) {
    assert.deepEqual(
      f.options.map((o) => o.value),
      channelIds,
    );
  }
  assert.ok(field('channels').default.every((id) => channelIds.includes(id)));
});

test('the tv_guide widget is declared with the moments the code knows', () => {
  const widget = manifest.widgets.find((w) => w.key === WIDGET_TV_GUIDE);
  assert.ok(widget);
  const moment = widget.settings.find((s) => s.key === 'moment');
  assert.deepEqual(moment.options.map((o) => o.value).sort(), Object.values(MOMENT).sort());
});

test('programme_started: every declared field and variable is in the event data', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === TRIGGER_PROGRAMME_STARTED);
  assert.ok(trigger);
  const guide = parseXmltv(
    '<programme start="20260101200000" stop="20260101210000" channel="TF1.fr"><title>T</title></programme>',
  );
  const data = buildStartedEvent('TF1.fr', guide.get('TF1.fr')[0]);
  for (const key of [...trigger.fields, ...trigger.variables].map((f) => f.key)) {
    assert.ok(key in data, `event data lacks "${key}"`);
  }
  assert.ok(Object.keys(data).length <= 30, 'event data is capped at 30 keys');
});

test('get_programme: the handler returns exactly the declared outputs', async () => {
  const action = manifest.scene_actions.find((a) => a.key === ACTION_GET_PROGRAMME);
  assert.ok(action);
  const realFetch = globalThis.fetch;
  stubGuideDownload(
    completeGuide(
      '<tv><programme start="20260101200000" stop="20260101210000" channel="TF1.fr"><title>T</title></programme></tv>',
    ),
  );
  try {
    const outputs = await getProgrammeAction({ channel: 'TF1.fr' });
    assert.deepEqual(Object.keys(outputs).sort(), action.outputs.map((o) => o.key).sort());
  } finally {
    globalThis.fetch = realFetch;
    resetGuideCache();
  }
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
