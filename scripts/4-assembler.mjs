// 4. L'ASSEMBLAGE — depuis les prises mesurées :
//   ratios.json : par langue et par voix, ratio = MÉDIANE des prises de
//                 (parlé Gemini ÷ SONDE), silences retirés des deux côtés ; la sonde
//                 est l'ESTIMATION de spark-duree depuis le 2026-10-11 (duree.json,
//                 2-duree.mjs ; avant, la durée Edge d'edge.json) — les prises Gemini
//                 restent celles du 2026-10-04 ; c'est la table que le doublage lit.
//   gemini/<langue>/<voix>.mp3 : l'extrait d'écoute = la prise MÉDIANE, rognée
//                 de ses silences de tête et de queue (TEN-VAD de la prod) ;
//   voices.json : le catalogue que le front lit (voix, langues, extraits).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ANCIEN_DEPOT, MODELE_TTS, PRISES, fichier } from './lib/config.mjs';
import { GEMINI_VOICES, LANGUES } from './lib/prod.mjs';
import { fermerVad, mesurerParoleNode } from './lib/vad-node.mjs';
import { ecrireJson, enParallele, lireJson } from './lib/outils.mjs';
import { lisser } from './lib/lissage.mjs';

const MARGE_S = 0.08;

const phrases = lireJson(fichier('phrases.json'), null);
const reference = lireJson(fichier('duree.json'), null);
if (!phrases || !reference) throw new Error('phrases.json et duree.json requis (2-duree.mjs)');
const ancien = lireJson(`${ANCIEN_DEPOT}/voices.json`, { voices: {} });
const precedent = lireJson(fichier('ratios.json'), { langues: {} });

// Dernière mesure de chaque prise (une prise refaite remplace l'ancienne).
const prises = new Map();
for (const ligne of fs.readFileSync(fichier('cache', 'mesures.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const m = JSON.parse(ligne);
  prises.set(`${m.langue}|${m.voix}|${m.prise}`, m);
}

const mediane = (xs) => {
  const t = [...xs].sort((a, b) => a - b);
  const k = t.length >> 1;
  return t.length % 2 ? t[k] : (t[k - 1] + t[k]) / 2;
};

const ratios = {
  version: 1, modele: MODELE_TTS, prises_par_voix: PRISES,
  methode: 'une phrase par langue, lue PRISES fois par chaque voix avec la requête du doublage de la prod ; ratio = médiane de (parlé Gemini ÷ sonde), TEN-VAD de la prod (silences ≥ 150 ms retirés) ; sonde = durée parlée ESTIMÉE par spark-duree (texte nettoyé comme les sondes de la prod)',
  sonde: 'duree',
  genere_le: new Date().toISOString(), langues: {},
};
const extraits = [];
const manquants = [];

for (const l of LANGUES) {
  const e = reference.langues[l.code];
  if (!e) throw new Error(`duree.json sans ${l.code} : relancer 2-duree.mjs`);
  const entree = { sonde: 'duree', duree_s: e.duree_s, phrase: phrases.langues[l.code].texte, voix: {} };
  for (const v of GEMINI_VOICES.map((x) => x.name)) {
    const mesures = [];
    for (let k = 1; k <= PRISES; k++) {
      const m = prises.get(`${l.code}|${v}|${k}`);
      if (m && m.parle_s > 0) mesures.push({ k, parle_s: m.parle_s, ratio: m.parle_s / e.duree_s });
    }
    if (mesures.length < PRISES) { manquants.push(`${l.code}/${v} (${mesures.length}/${PRISES})`); continue; }
    const ratio = mediane(mesures.map((m) => m.ratio));
    const extrait = mesures.reduce((a, b) => (Math.abs(b.ratio - ratio) < Math.abs(a.ratio - ratio) ? b : a));
    entree.voix[v] = {
      ratio: Number(ratio.toFixed(4)),
      ratios: mesures.map((m) => Number(m.ratio.toFixed(4))),
      parle_s: mesures.map((m) => m.parle_s),
      prise_extrait: extrait.k,
    };
    const mp3 = fichier('gemini', l.code, `${v.toLowerCase()}.mp3`);
    if (!fs.existsSync(mp3) || precedent.langues?.[l.code]?.voix?.[v]?.prise_extrait !== extrait.k) {
      extraits.push({ wav: fichier('cache', 'prises', l.code, `${v}_${extrait.k}.wav`), mp3 });
    }
  }
  ratios.langues[l.code] = entree;
}

/** PCM d'un WAV écrit par 3-gemini.mjs (entête de 44 octets). */
function lireWav(chemin) {
  const b = fs.readFileSync(chemin);
  const pcm = new Int16Array((b.length - 44) >> 1);
  new Uint8Array(pcm.buffer).set(b.subarray(44, 44 + pcm.byteLength));
  return { pcm, taux: b.readUInt32LE(24) };
}

console.log(`${extraits.length} extrait(s) à produire`);
await enParallele(extraits.map(({ wav, mp3 }) => async () => {
  const { pcm, taux } = lireWav(wav);
  const m = await mesurerParoleNode(pcm, taux);
  const sil = m.silences || [];
  const debut = sil.length && sil[0][0] <= 0.001 ? Math.max(0, sil[0][1] - MARGE_S) : 0;
  const dernier = sil[sil.length - 1];
  const fin = dernier && dernier[1] >= m.total_s - 0.02 ? Math.min(m.total_s, dernier[0] + MARGE_S) : m.total_s;
  fs.mkdirSync(fichier('gemini', mp3.split(/[\\/]/).slice(-2, -1)[0]), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', debut.toFixed(3), '-to', fin.toFixed(3), '-i', wav,
    '-ac', '1', '-ar', String(taux), '-c:a', 'libmp3lame', '-b:a', '96k', mp3]);
}), 8, (n, total, r) => { if (r?.erreur) console.log(`ÉCHEC extrait : ${r.erreur}`); else if (n % 100 === 0 || n === total) console.log(`${n}/${total} extraits`); });

await fermerVad();
// Le doublage lit le ratio LISSÉ (vitesse de la langue × vitesse de la voix, lib/lissage.mjs) ; la
// médiane brute des prises reste en `ratio_mesure`. Les extraits ont été choisis sur la mesure brute.
lisser(ratios);
ecrireJson(fichier('ratios.json'), ratios);

// Le catalogue du front : les champs d'affichage de l'ancien dépôt (genre,
// style, hauteur, description), les extraits PRÉSENTS seulement.
const voices = {
  version: 1, modele: MODELE_TTS,
  languages: Object.fromEntries(LANGUES.map((l) => [l.code, l.en])),
  phrases: Object.fromEntries(LANGUES.map((l) => [l.code, phrases.langues[l.code].texte])),
  voices: {},
};
for (const v of GEMINI_VOICES) {
  const a = ancien.voices?.[v.name] || {};
  const files = {};
  for (const l of LANGUES) {
    const rel = `gemini/${l.code}/${v.name.toLowerCase()}.mp3`;
    if (fs.existsSync(fichier(rel))) files[l.code] = rel;
  }
  voices.voices[v.name] = {
    gender: a.gender || v.gender, style: a.style || v.style, pitch: a.pitch || v.pitch,
    description: a.description || v.description, provider: 'gemini', files,
  };
}
ecrireJson(fichier('voices.json'), voices);

console.log(manquants.length ? `${manquants.length} (langue, voix) incomplètes — relancer 3-gemini.mjs : ${manquants.slice(0, 12).join(', ')}${manquants.length > 12 ? '…' : ''}` : `complet : ${LANGUES.length} langues × ${GEMINI_VOICES.length} voix`);
