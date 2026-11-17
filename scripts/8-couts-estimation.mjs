// 8. LES COÛTS DES RÉGÉNÉRATIONS, MESURÉS (2026-11-17, le propriétaire : « on peut faire plusieurs exemples en local et
// on enregistre les valeurs les plus hautes avec des gros arrondis » ; « on doit faire pour chaque langue, car les
// tokens peuvent varier » ; « des variantes avec émotion, car on peut les ajouter dans les régénérations » ; « on va
// plutôt choisir des phrases, pas des voix… une voix pour chaque langue »).
//
// Les JETONS que coûte la voix, avec la requête de la PROD, pour les deux modèles du doublage :
//   - sans ton : chaque langue (3.8 Flash : les 60 ; Flash-Lite : ses 49), SA voix la plus lente (la médiane de ses jetons
//     par caractère la plus haute dans cache/mesures.jsonl), 6 textes — une courte (le début d'une phrase), les 4
//     moyennes (phrases.json et shared/phrases-ratio), une longue (les 4 bout à bout) —, PRISES prises chacun ;
//   - avec un ton : les 100 tons du studio, sur 4 écritures (fr, ja, ar, cmn), 2 phrases moyennes, 1 prise.
// Rien n'est gardé de l'audio : seulement les jetons (cache/couts.jsonl, en ajout — un lancement interrompu reprend).
//   --prises 2   --a-blanc (montre la requête d'un texte avec un ton, ne paie rien)
import fs from 'node:fs';
import path from 'node:path';
import { EN_PARALLELE, WORKERS, fichier, prod } from './lib/config.mjs';
import { requeteGemini } from './lib/prod.mjs';
import { priseGemini } from './lib/gemini.mjs';
import { enParallele, lireJson, options } from './lib/outils.mjs';

const { EMOTION_TONS } = await import(prod('spark-dubbing-api/src/services/emotion-tons.js'));

const opts = options();
const PRISES = Number(opts.prises || 2);
const MODELES = { flash: 'gemini-3.8-flash-tts', lite: 'gemini-3.8-flash-lite-tts' };
const LANGUES_DES_TONS = ['fr', 'ja', 'ar', 'cmn'];

const ratios = lireJson(fichier('ratios.json'), null);
const phrasesRatio = JSON.parse(fs.readFileSync(path.join(WORKERS, 'shared/phrases-ratio/phrases.json'), 'utf8'));
const catalogue = JSON.parse(fs.readFileSync(path.join(WORKERS, 'shared/langues/langues.json'), 'utf8'));
const lite = new Set(catalogue.langues.filter((l) => l.gemini_lite).map((l) => l.code));
const langues = Object.keys(ratios.langues);

/** La voix la plus lente de chaque langue : la médiane de ses jetons audio par caractère, la plus haute (3.8 Flash). */
const lentes = (() => {
  const par = new Map();
  for (const ligne of fs.readFileSync(fichier('cache', 'mesures.jsonl'), 'utf8').trim().split('\n')) {
    const m = JSON.parse(ligne);
    const ph = ratios.langues[m.langue]?.phrase;
    if (!ph || !m.jetons_audio) continue;
    const cle = `${m.langue}|${m.voix}`;
    if (!par.has(cle)) par.set(cle, []);
    par.get(cle).push(m.jetons_audio / [...ph].length);
  }
  const out = {};
  for (const [cle, v] of par) {
    const [langue, voix] = cle.split('|');
    const mediane = v.sort((a, b) => a - b)[v.length >> 1];
    if (!out[langue] || mediane > out[langue].mediane) out[langue] = { voix, mediane };
  }
  return out;
})();

/** Les 6 textes d'une langue : une courte, les 4 moyennes, une longue. */
function textes(langue) {
  const moyennes = [ratios.langues[langue].phrase, ...((phrasesRatio.langues || phrasesRatio)[langue] || [])];
  const premiere = moyennes[0];
  const coupe = premiere.split(/[,，、،]/)[0].trim();
  const courte = [...coupe].length >= 2 && coupe.length < premiere.length ? coupe : [...premiere].slice(0, 8).join('');
  return [
    { sorte: 'courte', texte: courte },
    ...moyennes.map((texte, i) => ({ sorte: `moyenne${i + 1}`, texte })),
    { sorte: 'longue', texte: moyennes.join(' ') },
  ];
}

const cleDe = (t) => [t.modele, t.langue, t.sorte, t.ton || '', t.prise].join('|');
const journal = fichier('cache', 'couts.jsonl');
const faites = new Set(fs.existsSync(journal)
  ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map((l) => cleDe(JSON.parse(l)))
  : []);

const taches = [];
for (const [nom, modele] of Object.entries(MODELES)) {
  for (const langue of langues) {
    if (nom === 'lite' && !lite.has(langue)) continue;
    const voix = lentes[langue]?.voix;
    if (!voix) continue;
    for (const t of textes(langue)) {
      for (let prise = 1; prise <= PRISES; prise++) taches.push({ modele, langue, voix, ...t, ton: null, prise });
    }
  }
  for (const langue of LANGUES_DES_TONS) {
    if (nom === 'lite' && !lite.has(langue)) continue;
    const voix = lentes[langue].voix;
    for (const t of textes(langue).filter((x) => x.sorte === 'moyenne1' || x.sorte === 'moyenne2')) {
      for (const ton of EMOTION_TONS) taches.push({ modele, langue, voix, ...t, ton, prise: 1 });
    }
  }
}
const restantes = taches.filter((t) => !faites.has(cleDe(t)));

if (opts['a-blanc']) {
  const t = taches.find((x) => x.ton) || taches[0];
  console.log(`${taches.length} prises en tout, ${restantes.length} à faire`);
  console.log(`modèle ${t.modele}, langue ${t.langue}, voix ${t.voix}, ton ${t.ton}`);
  console.log(JSON.stringify(requeteGemini({ voix: t.voix, texte: t.texte, langue: t.langue, ton: t.ton }).corps, null, 2));
  process.exit(0);
}

console.log(`${taches.length} prises en tout, ${restantes.length} à faire (${EN_PARALLELE} en parallèle)`);
let jetons = 0;
let faitesIci = 0;
await enParallele(restantes.map((t) => async () => {
  const p = await priseGemini({ voix: t.voix, texte: t.texte, langue: t.langue, modele: t.modele, ton: t.ton });
  const ligne = {
    modele: t.modele, langue: t.langue, voix: t.voix, sorte: t.sorte, ton: t.ton, prise: t.prise,
    caracteres: [...t.texte].length, jetons_entree: p.jetons_entree, jetons_audio: p.jetons_audio,
    total_s: p.pcm.length / p.taux, essais: p.essais,
  };
  fs.appendFileSync(journal, `${JSON.stringify(ligne)}\n`);
  jetons += p.jetons_audio;
  faitesIci += 1;
  if (faitesIci % 50 === 0) console.log(`${faitesIci}/${restantes.length} — ${jetons} jetons audio`);
  return ligne;
}), EN_PARALLELE);
console.log(`fini : ${faitesIci} prises, ${jetons} jetons audio`);
