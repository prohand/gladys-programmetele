// -----------------------------------------------------------------------------
// Guide fixtures for the tests that go through the download.
//
// A downloaded guide must list at least MIN_GUIDE_CHANNELS of the known
// channels (src/guide.js), and the fixture has two: `completeGuide` adds one
// programme to every channel it lacks, on a day of the year 2000 by default so
// the schedules the tests look at are untouched.
// -----------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { CHANNELS } from '../../src/channels.js';

export const fixtureXml = await readFile(new URL('../fixtures/guide.xml', import.meta.url), 'utf8');

const xmltvDate = (date) =>
  `${new Date(date).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;

/**
 * @param {string} xml an XMLTV document
 * @param {{ start?: Date|number, stop?: Date|number }} [range] of the added programmes
 */
export function completeGuide(
  xml = fixtureXml,
  { start = Date.UTC(2000, 0, 1, 0), stop = Date.UTC(2000, 0, 1, 1) } = {},
) {
  const present = new Set([...xml.matchAll(/channel="([^"]+)"/g)].map((match) => match[1]));
  const added = CHANNELS.filter((channel) => !present.has(channel.id))
    .map(
      (channel) =>
        `<programme start="${xmltvDate(start)}" stop="${xmltvDate(stop)}" channel="${channel.id}"><title>Filler</title></programme>`,
    )
    .join('\n');
  return xml.replace(/<\/tv>\s*$/, `${added}\n</tv>\n`);
}

/**
 * Stub `fetch` with one answer for every call; returns the request log.
 * @param {(request: { url: string, headers: object }) => Response} answer
 */
export function stubFetch(answer) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url, headers: init.headers ?? {} };
    requests.push(request);
    return answer(request);
  };
  return requests;
}

/** Stub `fetch` with a complete guide built from the fixture. */
export function stubGuideDownload(xml = completeGuide()) {
  return stubFetch(() => new Response(Buffer.from(xml)));
}
