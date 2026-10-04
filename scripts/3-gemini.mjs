// 3. LES PRISES GEMINI — chaque voix lit la phrase de chaque langue PRISES fois,
// avec la requête de la prod ; chaque prise est gardée (cache/prises, WAV) et
// sa durée parlée mesurée par le TEN-VAD de la prod (lib/vad-node.mjs : le même
// code et le même wasm que spark-vad, parité vérifiée par verifier-vad.mjs). Journal en ajout
// (cache/mesures.jsonl) : un lancement interrompu reprend où il s'était arrêté.
//   --langues fr,es-us   --voix Kore,Puck   --prises 3   --a-blanc (montre la requête)
import fs from 'node:fs';
import path from 'node:path';
import { EN_PARALLELE, PRISES, fichier } from './lib/config.mjs';
import { GEMINI_VOICES, LANGUES, requeteGemini } from './lib/prod.mjs';
import { priseGemini } from './lib/gemini.mjs';
import { fermerVad, mesurerParoleNode } from './lib/vad-node.mjs';
import { enParallele, liste, lireJson, options } from './lib/outils.mjs';

const opts = options();
const filtreLangues = liste(opts.langues);
const filtreVoix = liste(opts.voix);
const prises = Number(opts.prises || PRISES);

const phrases = lireJson(fichier('phrases.json'), null);
if (!phrases) throw new Error('phrases.json absent : lancer 1-phrases.mjs');

const langues = LANGUES.filter((l) => filtreLangues.size === 0 || filtreLangues.has(l.code));
const voix = GEMINI_VOICES.map((v) => v.name).filter((n) => filtreVoix.size === 0 || filtreVoix.has(n));

if (opts['a-blanc']) {
  const l = langues[0];
  const { corps } = requeteGemini({ voix: voix[0], texte: phrases.langues[l.code].texte, langue: l.code });
  console.log(JSON.stringify(corps, null, 2));
  process.exit(0);
}

const journal = fichier('cache', 'mesures.jsonl');
fs.mkdirSync(path.dirname(journal), { recursive: true });
const faites = new Set(
  fs.existsSync(journal)
    ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => `${m.langue}|${m.voix}|${m.prise}`)
    : [],
);

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

const taches = [];
for (const l of langues) {
  for (const v of voix) {
    for (let k = 1; k <= prises; k++) {
      if (faites.has(`${l.code}|${v}|${k}`)) continue;
      taches.push(async () => {
        const t0 = Date.now();
        const p = await priseGemini({ voix: v, texte: phrases.langues[l.code].texte, langue: l.code });
        const chemin = fichier('cache', 'prises', l.code, `${v}_${k}.wav`);
        fs.mkdirSync(path.dirname(chemin), { recursive: true });
        fs.writeFileSync(chemin, wav(p.pcm, p.taux));
        const m = await mesurerParoleNode(p.pcm, p.taux);
        const ligne = {
          langue: l.code, voix: v, prise: k, parle_s: m.parle_s, total_s: m.total_s,
          jetons_entree: p.jetons_entree, jetons_audio: p.jetons_audio, essais: p.essais, ms: Date.now() - t0,
        };
        fs.appendFileSync(journal, `${JSON.stringify(ligne)}\n`);
        return ligne;
      });
    }
  }
}

console.log(`${langues.length} langue(s) × ${voix.length} voix × ${prises} prises : ${taches.length} à faire (${faites.size} déjà faites), ${EN_PARALLELE} en parallèle`);
let jetons = 0;
let echecs = 0;
const debut = Date.now();
await enParallele(taches, EN_PARALLELE, (n, total, r) => {
  if (r?.erreur) { echecs++; console.log(`ÉCHEC ${r.erreur}`); return; }
  jetons += r.jetons_audio;
  if (n % 25 === 0 || n === total) {
    const min = (Date.now() - debut) / 60000;
    console.log(`${n}/${total} — ${echecs} échec(s), ${jetons} jetons audio, ${min.toFixed(1)} min`);
  }
});
await fermerVad();
console.log(`fini : ${taches.length - echecs} prises, ${echecs} échec(s) — relancer reprend les manquantes`);
process.exit(echecs > 0 ? 2 : 0);
