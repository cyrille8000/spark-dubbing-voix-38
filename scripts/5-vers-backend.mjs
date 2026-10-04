// 5. LA TABLE POUR LE DOUBLAGE — copie compacte de ratios.json dans le dépôt
// backend : workers/shared/ratios-gemini/ratios.json, lue par spark-dubbing-api
// (calibration-gemini.js). Refuse d'écrire une table incomplète : chaque langue
// proposée doit avoir ses 30 voix (le test du backend l'exige aussi).
import fs from 'node:fs';
import path from 'node:path';
import { WORKERS, fichier } from './lib/config.mjs';
import { GEMINI_VOICES, LANGUES } from './lib/prod.mjs';
import { ecrireJson, lireJson } from './lib/outils.mjs';

const ratios = lireJson(fichier('ratios.json'), null);
if (!ratios) throw new Error('ratios.json absent : lancer 4-assembler.mjs');

const trous = [];
const langues = {};
for (const l of LANGUES) {
  const e = ratios.langues[l.code];
  const voix = {};
  for (const v of GEMINI_VOICES) {
    const r = e?.voix?.[v.name]?.ratio;
    if (r > 0) voix[v.name] = r; else trous.push(`${l.code}/${v.name}`);
  }
  langues[l.code] = { voix_edge: e?.voix_edge, voix };
}
if (trous.length) throw new Error(`table incomplète (${trous.length}) : ${trous.slice(0, 10).join(', ')}…`);

const cible = path.join(WORKERS, 'shared/ratios-gemini/ratios.json');
ecrireJson(cible, {
  version: ratios.version, modele: ratios.modele, genere_le: ratios.genere_le,
  prises_par_voix: ratios.prises_par_voix, methode: ratios.methode,
  source: 'dépôt spark-dubbing-voix-38 (scripts 1 à 5)',
  langues,
});
console.log(`écrit ${cible} : ${LANGUES.length} langues × ${GEMINI_VOICES.length} voix (${fs.statSync(cible).size} octets)`);
