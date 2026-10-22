// 7. LES 3 PHRASES DU RATIO DES GAMMES À CLÉ (ElevenLabs, Inworld) — 2026-10-13.
//
// Décision du propriétaire : le ratio de débit d'une voix ne se mesure plus sur UNE phrase du
// projet, traduite, mais sur 3 phrases de TAILLE MOYENNE, les MÊMES pour toutes les voix d'une
// langue, déjà écrites dans cette langue ; le ratio = la médiane des 3. Une lecture un peu
// rapide ou lente d'une phrase ne fait plus le ratio de tout le doublage.
//
// Langues : celles que spark-duree estime (champ `duree` du catalogue, 60) — les seules
// proposées en ElevenLabs et Inworld. Les 3 phrases sont traduites par le traducteur de la prod
// (OpenAI, effort bas). Pas celle de la table Gemini (phrases.json) : 106 caractères en anglais,
// 141 en français — trop longue. Écrit phrases_ratio.json ; une phrase déjà traduite est gardée.
//
//   node scripts/7-phrases-ratio.mjs --a-blanc        (la requête exacte, aucun appel)
//   node scripts/7-phrases-ratio.mjs                  (les traductions)
//   node scripts/7-phrases-ratio.mjs --vers-backend   (copie dans backend/.../shared/phrases-ratio/)
import fs from 'node:fs';
import path from 'node:path';
import { MODELE_TRADUCTION, WORKERS, fichier } from './lib/config.mjs';
import { ecrireJson, enParallele, lireJson, options, secret } from './lib/outils.mjs';
import { requeteTraduction, traduirePhrase } from './lib/traduction.mjs';

/** Les 3 phrases : ordinaires, de TAILLE MOYENNE (83 à 85 caractères en anglais, ~5 s
 *  dites), sans chiffre ni nom propre (l'estimation les lirait mal). */
export const SOURCES = [
  'When we reached the top of the hill, the whole valley was hidden under a thick fog.',
  'I have been learning to cook for a few months, and I am finally starting to enjoy it.',
  'If you leave a little earlier tomorrow, you should avoid most of the traffic in town.',
];

const opts = options();
const catalogue = JSON.parse(fs.readFileSync(path.join(WORKERS, 'shared/langues/langues.json'), 'utf8'));
const LANGUES = catalogue.langues.filter((l) => l.duree);

const chemin = fichier('phrases_ratio.json');
const doc = lireJson(chemin, { sources: SOURCES, modele: MODELE_TRADUCTION, langues: {} });
if (JSON.stringify(doc.sources) !== JSON.stringify(SOURCES)) {
  throw new Error('phrases_ratio.json a été traduit depuis d’autres phrases : effacez-le pour recommencer');
}

for (const l of LANGUES) doc.langues[l.code] = { nom: l.en, textes: doc.langues[l.code]?.textes || [] };

const aFaire = LANGUES.flatMap((l) => SOURCES.map((source, i) => ({ l, i, source })))
  .filter(({ l, i }) => !doc.langues[l.code].textes[i]);

if (opts['vers-backend']) {
  const manquantes = LANGUES.filter((l) => doc.langues[l.code].textes.filter(Boolean).length < SOURCES.length);
  if (manquantes.length) throw new Error(`phrases manquantes : ${manquantes.map((l) => l.code).join(', ')}`);
  const sortie = path.join(WORKERS, 'shared/phrases-ratio/phrases.json');
  ecrireJson(sortie, {
    version: 1,
    sources: SOURCES,
    langues: Object.fromEntries(LANGUES.map((l) => [l.code, doc.langues[l.code].textes])),
  });
  console.log(`${LANGUES.length} langues × ${SOURCES.length} phrases → ${sortie}`);
  process.exit(0);
}

if (opts['a-blanc']) {
  console.log(`${LANGUES.length} langues ; ${aFaire.length} traductions à faire (${MODELE_TRADUCTION}, effort bas) ; la première :`);
  if (aFaire[0]) console.log(JSON.stringify(requeteTraduction(aFaire[0].l, aFaire[0].source), null, 2));
  process.exit(0);
}

const cle = secret('OPENAI_API_KEY');
await enParallele(aFaire.map(({ l, i, source }) => async () => {
  const texte = await traduirePhrase(cle, l, source);
  doc.langues[l.code].textes[i] = texte;
  ecrireJson(chemin, doc);
  return `${l.code} ${i + 1} : ${texte}`;
}), 8, (n, total, r) => console.log(`${n}/${total} ${r?.erreur ? `ÉCHEC ${r.erreur}` : r}`));
ecrireJson(chemin, doc);

const manquantes = LANGUES.filter((l) => doc.langues[l.code].textes.filter(Boolean).length < SOURCES.length);
console.log(manquantes.length ? `MANQUANTES : ${manquantes.map((l) => l.code).join(', ')}` : `les ${LANGUES.length} langues ont leurs ${SOURCES.length} phrases`);
