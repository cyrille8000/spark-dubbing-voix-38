// 6. LA VITESSE D'UNE LANGUE SUR PLUSIEURS PHRASES (2026-10-11).
//
// La table mesure chaque langue sur UNE phrase : quand cette phrase se dit, toutes voix confondues, plus
// vite qu'un texte ordinaire, toute la langue hérite de l'écart (thaï : ~10 % trop court sur un vrai
// doublage). Ici : N phrases × quelques voix × 1 prise, avec la requête de la prod ; ratio de chaque
// prise = parlé Gemini ÷ estimation spark-duree de la phrase, ramené à la vitesse de la voix (table
// lissée) ; vitesse mesurée de la langue = médiane de ces ratios. 4-assembler.mjs / 4b-lisser.mjs la
// reprennent à la place de la vitesse tirée de la phrase unique (lib/lissage.mjs).
//
//   node scripts/6-mesure-langue.mjs --langue th --voix Sadachbia,Laomedeia,Iapetus --a-blanc
//   node scripts/6-mesure-langue.mjs --langue th --voix Sadachbia,Laomedeia,Iapetus            (les prises)
//   node scripts/6-mesure-langue.mjs --langue th --voix Sadachbia,Laomedeia,Iapetus --estimer   (le calcul)
//
// Phrases : phrases_multiples/<langue>.json. Journal en ajout cache/multiples.jsonl : une prise faite ne
// se refait JAMAIS (on ne paie pas deux fois). Le calcul appelle spark-duree (DUREE_URL, voir 2-duree.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { DUREE_URL, fichier } from './lib/config.mjs';
import { requeteGemini, texteEdge } from './lib/prod.mjs';
import { priseGemini } from './lib/gemini.mjs';
import { fermerVad, mesurerParoleNode } from './lib/vad-node.mjs';
import { ecrireJson, enParallele, liste, lireJson, options } from './lib/outils.mjs';

const opts = options();
const langue = opts.langue;
const voix = [...liste(opts.voix)];
if (!langue || voix.length === 0) throw new Error('--langue et --voix requis');
const source = lireJson(fichier('phrases_multiples', `${langue}.json`), null);
if (!source) throw new Error(`phrases_multiples/${langue}.json absent`);
const phrases = source.phrases;

if (opts['a-blanc']) {
  const { corps } = requeteGemini({ voix: voix[0], texte: phrases[0], langue });
  console.log(`${phrases.length} phrases × ${voix.length} voix × 1 prise = ${phrases.length * voix.length} appels ; la première :`);
  console.log(JSON.stringify(corps, null, 2));
  process.exit(0);
}

const journal = fichier('cache', 'multiples.jsonl');
fs.mkdirSync(path.dirname(journal), { recursive: true });
const lignes = fs.existsSync(journal)
  ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.langue === langue)
  : [];
const cle = (i, v) => `${i}|${v}`;
const faites = new Map(lignes.map((m) => [cle(m.phrase, m.voix), m]));

/** WAV 16 bits mono (44 octets d'entête + PCM). */
function wav(pcm, taux) {
  const donnees = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + donnees.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(taux, 24); h.writeUInt32LE(taux * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(donnees.length, 40);
  return Buffer.concat([h, donnees]);
}

const mediane = (xs) => {
  const t = [...xs].sort((a, b) => a - b);
  const k = t.length >> 1;
  return t.length % 2 ? t[k] : (t[k - 1] + t[k]) / 2;
};

if (!opts.estimer) {
  const taches = [];
  phrases.forEach((texte, i) => {
    for (const v of voix) {
      if (faites.has(cle(i, v))) continue;
      taches.push(async () => {
        const p = await priseGemini({ voix: v, texte, langue });
        const chemin = fichier('cache', 'multiples', langue, `${v}_${i}.wav`);
        fs.mkdirSync(path.dirname(chemin), { recursive: true });
        fs.writeFileSync(chemin, wav(p.pcm, p.taux));
        const m = await mesurerParoleNode(p.pcm, p.taux);
        const ligne = {
          langue, phrase: i, voix: v, parle_s: m.parle_s, total_s: m.total_s,
          jetons_entree: p.jetons_entree, jetons_audio: p.jetons_audio, essais: p.essais,
        };
        fs.appendFileSync(journal, `${JSON.stringify(ligne)}\n`);
        return ligne;
      });
    }
  });
  console.log(`${taches.length} prise(s) à faire (${faites.size} déjà faites)`);
  let jetons = 0;
  let echecs = 0;
  await enParallele(taches, 3, (n, total, r) => {
    if (r?.erreur) { echecs++; console.log(`ÉCHEC ${r.erreur}`); return; }
    jetons += r.jetons_audio;
    console.log(`${n}/${total} — phrase ${r.phrase + 1} ${r.voix} : ${r.parle_s.toFixed(2)} s parlées (${r.jetons_audio} jetons audio, ${r.essais} essai(s))`);
  });
  await fermerVad();
  console.log(`fini : ${taches.length - echecs} prise(s), ${echecs} échec(s), ${jetons} jetons audio`);
  process.exit(echecs > 0 ? 2 : 0);
}

// ── Le calcul : estimation de chaque phrase, ratio de chaque prise, vitesse de la langue ──
const textes = phrases.map((p) => texteEdge(p));
const r = await fetch(`${DUREE_URL}/estimer`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ langue, textes }),
});
const corps = await r.json();
if (r.status !== 200) throw new Error(`spark-duree HTTP ${r.status} : ${corps.erreur}`);
const table = lireJson(fichier('ratios.json'), null);
const vitesseVoix = table?.vitesses_voix || {};
const prises = [];
for (const m of faites.values()) {
  const estimation = corps.durees[m.phrase];
  if (!(estimation > 0) || !(m.parle_s > 0)) continue;
  const ratio = m.parle_s / estimation;
  prises.push({ ...m, estimation, ratio, ramene: ratio / (vitesseVoix[m.voix] || 1) });
}
const vitesse = mediane(prises.map((p) => p.ramene));
const parVoix = Object.fromEntries(voix.map((v) => [v, mediane(prises.filter((p) => p.voix === v).map((p) => p.ratio))]));
const resultat = {
  langue, mesure_le: new Date().toISOString(), phrases: phrases.length, voix, prises: prises.length,
  vitesse_langue: Number(vitesse.toFixed(4)),
  vitesse_phrase_unique: table?.langues?.[langue]?.vitesse_langue ?? null,
  ratio_par_voix: Object.fromEntries(Object.entries(parVoix).map(([v, x]) => [v, Number(x.toFixed(4))])),
  detail: prises.map((p) => ({ phrase: p.phrase, voix: p.voix, parle_s: p.parle_s, estimation: p.estimation, ratio: Number(p.ratio.toFixed(4)) })),
  source: source.source,
};
ecrireJson(fichier('phrases_multiples', `${langue}_mesure.json`), resultat);
console.log(JSON.stringify({ ...resultat, detail: undefined }, null, 1));
