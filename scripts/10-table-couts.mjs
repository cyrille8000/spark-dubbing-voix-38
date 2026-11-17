// 10. LA TABLE DES COÛTS D'ESTIMATION (2026-11-17) — tirée des mesures de 8-couts-estimation.mjs (la voix) et de
// 9-couts-reecriture.mjs (le texte), écrite dans le backend : `shared/couts-estimation/couts.json`, que les réserves des
// opérations IA du studio lisent (`spark-dubbing-api/src/utils/facturation/estimation.js`).
//
// Le propriétaire : « on enregistre les valeurs les plus hautes avec des gros arrondis ». Pour chaque modèle et chaque
// langue, le coût d'un segment = `par_appel` + `par_caractere` × ses caractères :
//   - par_appel     = la PIRE prise du texte court (le coût fixe d'un appel : la requête, les silences de tête et de queue) ;
//   - par_caractere = la PIRE prise du texte long, rapportée à ses caractères (le fixe y est compté une 2e fois : prudent) ;
// puis × 1,2 et arrondis AU-DESSUS à deux chiffres significatifs. Les jetons d'entrée sont comptés au plein tarif (le
// cache de la prod n'est jamais supposé). Un ton multiplie la voix : le facteur = sa pire prise ÷ la moyenne des prises
// neutres du même texte, sur 4 écritures (fr, ja, ar, cmn), arrondi au-dessus au 0,05 (1 au moins). `pire` : la valeur
// pour une langue ou un ton absents de la table.
import fs from 'node:fs';
import path from 'node:path';
import { WORKERS, fichier } from './lib/config.mjs';

const PRIX_VOIX = { 'gemini-3.8-flash-tts': { entree: 1, audio: 18 }, 'gemini-3.8-flash-lite-tts': { entree: 1, audio: 12 } };
const PRIX_TEXTE = { 'gpt-6-luna': { entree: 0.1, sortie: 0.5 } };
const MODELE_TEXTE = process.env.OPENAI_MODEL_REFINE || 'gpt-6-luna';

const lire = (f) => fs.readFileSync(fichier('cache', f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
/** × 1,2, arrondi au-dessus à deux chiffres significatifs. */
const arrondi = (x) => {
  const v = x * 1.2;
  if (!(v > 0)) return 0;
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Number((Math.ceil(v / p - 1e-9) * p).toPrecision(2));
};
const auCinq = (x) => Math.max(1, Math.ceil(x * 20 - 1e-9) / 20);
const max = (v) => Math.max(...v);

/** `{ langue: { par_appel, par_caractere } }` + `pire`, depuis des lignes `{ langue, sorte, caracteres }` et leur coût. */
function tableDesLangues(lignes, cout) {
  const par = new Map();
  for (const l of lignes) {
    if (!par.has(l.langue)) par.set(l.langue, []);
    par.get(l.langue).push(l);
  }
  const langues = {};
  for (const [langue, ls] of [...par].sort()) {
    const courtes = ls.filter((l) => l.sorte === 'courte');
    const longues = ls.filter((l) => l.sorte === 'longue');
    if (!courtes.length || !longues.length) continue;
    langues[langue] = {
      par_appel: arrondi(max(courtes.map(cout))),
      par_caractere: arrondi(max(longues.map((l) => cout(l) / l.caracteres))),
    };
  }
  const v = Object.values(langues);
  return { pire: { par_appel: max(v.map((x) => x.par_appel)), par_caractere: max(v.map((x) => x.par_caractere)) }, langues };
}

const voixLignes = lire('couts.jsonl');
const voix = {};
const tons = {};
for (const [modele, prix] of Object.entries(PRIX_VOIX)) {
  const cout = (l) => (l.jetons_entree * prix.entree + l.jetons_audio * prix.audio) / 1e6;
  const neutres = voixLignes.filter((l) => l.modele === modele && !l.ton);
  voix[modele] = tableDesLangues(neutres, cout);
  const facteurs = {};
  for (const l of voixLignes.filter((x) => x.modele === modele && x.ton)) {
    const ref = neutres.filter((n) => n.langue === l.langue && n.sorte === l.sorte);
    const moyenne = ref.reduce((s, n) => s + n.jetons_audio, 0) / ref.length;
    facteurs[l.ton] = Math.max(facteurs[l.ton] || 0, l.jetons_audio / moyenne);
  }
  const arrondis = Object.fromEntries(Object.entries(facteurs).sort().map(([t, f]) => [t, auCinq(f)]));
  tons[modele] = { pire: max(Object.values(arrondis)), facteurs: arrondis };
}

const texteLignes = lire('couts-reecriture.jsonl').map((l) => ({ ...l, langue: l.lang }));
const prixTexte = PRIX_TEXTE[MODELE_TEXTE];
const texte = {
  [MODELE_TEXTE]: tableDesLangues(texteLignes, (l) => (l.entree * prixTexte.entree + l.sortie * prixTexte.sortie) / 1e6),
};

const table = {
  version: 1,
  genere_le: new Date().toISOString(),
  methode: 'spark-dubbing-voix-38 : 8-couts-estimation.mjs (la voix, requête de la prod, la voix la plus lente de chaque '
    + 'langue, 6 textes × 2 prises ; les 100 tons sur fr, ja, ar, cmn), 9-couts-reecriture.mjs (les prompts exacts de '
    + 'build_variation_messages, 6 textes × raccourcir/allonger), 10-table-couts.mjs (cette table)',
  arrondi: 'coût d\'un segment = par_appel + par_caractere × caractères ; pire mesure × 1,2, arrondie au-dessus à deux '
    + 'chiffres significatifs ; entrée au plein tarif (aucun cache supposé) ; un ton multiplie la voix (pire facteur, au 0,05 au-dessus)',
  prix_par_million_de_jetons: { voix: PRIX_VOIX, texte: PRIX_TEXTE },
  mesures: { voix: voixLignes.length, texte: texteLignes.length },
  voix,
  tons,
  texte,
};
const sortie = path.join(WORKERS, 'shared/couts-estimation/couts.json');
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, `${JSON.stringify(table, null, 1)}\n`);
console.log(`écrit : ${sortie}`);
for (const [m, t] of Object.entries(voix)) console.log(`voix ${m} : ${Object.keys(t.langues).length} langues, pire ${JSON.stringify(t.pire)}`);
for (const [m, t] of Object.entries(tons)) console.log(`tons ${m} : pire ×${t.pire}`);
for (const [m, t] of Object.entries(texte)) console.log(`texte ${m} : ${Object.keys(t.langues).length} langues, pire ${JSON.stringify(t.pire)}`);
