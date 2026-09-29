// -----------------------------------------------------------------------------
// TNT channels available in the XMLTV guide (xmltvfr.fr, "TNT" file).
//
// `id` is the XMLTV channel id: it is used to find the programmes in the guide
// AND as the stable platform id of the Gladys device (never rename it).
// `name` is the label shown in Gladys.
//
// This list MUST stay in sync with the `channels` options of the manifest
// (checked by test/manifest.test.js).
// -----------------------------------------------------------------------------

export const CHANNELS = [
  { id: 'TF1.fr', name: 'TF1' },
  { id: 'France2.fr', name: 'France 2' },
  { id: 'France3.fr', name: 'France 3' },
  { id: 'CanalPlus.fr', name: 'Canal+' },
  { id: 'France5.fr', name: 'France 5' },
  { id: 'M6.fr', name: 'M6' },
  { id: 'Arte.fr', name: 'Arte' },
  { id: 'W9.fr', name: 'W9' },
  { id: 'TMC.fr', name: 'TMC' },
  { id: 'NT1.fr', name: 'TFX' },
  { id: 'LaChaineParlementaire.fr', name: 'LCP' },
  { id: 'France4.fr', name: 'France 4' },
  { id: 'BFMTV.fr', name: 'BFM TV' },
  { id: 'CNews.fr', name: 'CNews' },
  { id: 'CStar.fr', name: 'CStar' },
  { id: 'Gulli.fr', name: 'Gulli' },
  { id: 'T18.fr', name: 'T18' },
  { id: 'NOVO19.fr', name: 'NOVO19' },
  { id: 'TF1SeriesFilms.fr', name: 'TF1 Séries Films' },
  { id: 'LEquipe21.fr', name: "L'Équipe" },
  { id: '6ter.fr', name: '6ter' },
  { id: 'Numero23.fr', name: 'RMC Story' },
  { id: 'RMCDecouverte.fr', name: 'RMC Découverte' },
  { id: 'Cherie25.fr', name: 'RMC Life' },
  { id: 'LCI.fr', name: 'LCI' },
  { id: 'FranceInfo.fr', name: 'franceinfo:' },
  { id: 'ParisPremiere.fr', name: 'Paris Première' },
  { id: 'CanalPlusSport.fr', name: 'Canal+ Sport' },
  { id: 'CanalPlusCinema.fr', name: 'Canal+ Cinéma' },
  { id: 'PlanetePlus.fr', name: 'Planète+' },
];

/**
 * Find a channel by its XMLTV id.
 * @param {string} id
 */
export function findChannel(id) {
  return CHANNELS.find((channel) => channel.id === id);
}
