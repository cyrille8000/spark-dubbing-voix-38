// RÉPARATION (2026-10-04) — les prises du premier lancement gardaient la
// réponse de Gemini 3.8 ENTIÈRE (son entête WAV + le bloc C2PA de ~6 Ko après
// l'audio, entendu comme un grésillement de ~0,12 s, et compté comme de la
// parole quand il suivait la voix de près). On en extrait le chunk `data` comme
// la prod (`pcmDuWav`), on réécrit la prise et on REMESURE sa durée parlée
// (TEN-VAD de la prod). Aucun appel à Gemini. Idempotent : une prise déjà
// réparée est seulement remesurée.
import fs from 'node:fs';
import { fichier } from './lib/config.mjs';
import { pcmDuWav } from './lib/prod.mjs';
import { fermerVad, mesurerParoleNode } from './lib/vad-node.mjs';
import { enParallele } from './lib/outils.mjs';

function wav(pcm, taux) {
  const donnees = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + donnees.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(taux, 24); h.writeUInt32LE(taux * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(donnees.length, 40);
  return Buffer.concat([h, donnees]);
}

const journal = fichier('cache', 'mesures.jsonl');
const lignes = new Map();
for (const l of fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
  const m = JSON.parse(l);
  lignes.set(`${m.langue}|${m.voix}|${m.prise}`, m);
}

let reparees = 0;
const avant = [];
const apres = [];
await enParallele([...lignes.values()].map((m) => async () => {
  const chemin = fichier('cache', 'prises', m.langue, `${m.voix}_${m.prise}.wav`);
  const b = fs.readFileSync(chemin);
  const interieur = new Uint8Array(b.buffer, b.byteOffset + 44, b.length - 44);
  const extrait = pcmDuWav(interieur);
  let pcm;
  let taux = b.readUInt32LE(24);
  if (extrait) {
    pcm = new Int16Array(extrait.pcm.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(extrait.pcm.subarray(0, pcm.byteLength));
    taux = extrait.sampleRate;
    fs.writeFileSync(chemin, wav(pcm, taux));
    reparees++;
  } else {
    pcm = new Int16Array(interieur.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(interieur.subarray(0, pcm.byteLength));
  }
  const r = await mesurerParoleNode(pcm, taux);
  avant.push(m.parle_s);
  apres.push(r.parle_s);
  m.parle_s = r.parle_s;
  m.total_s = r.total_s;
  m.repare = true;
}), 8, (n, total) => { if (n % 1000 === 0 || n === total) console.log(`${n}/${total}`); });
await fermerVad();

fs.writeFileSync(`${journal}.tmp`, [...lignes.values()].map((m) => JSON.stringify(m)).join('\n') + '\n');
fs.renameSync(`${journal}.tmp`, journal);
const moy = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`${reparees} prise(s) réparée(s) ; parole moyenne ${moy(avant).toFixed(3)} s → ${moy(apres).toFixed(3)} s`);
