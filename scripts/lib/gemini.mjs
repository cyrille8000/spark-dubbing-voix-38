// L'appel Gemini 3.8 Flash TTS — la requête de la PROD (requeteGemini), les
// clés de la prod (Doppler GEMINI_API_TTS_KEYS, une par projet GCP, jamais
// affichées). Relances : 429 → une autre clé après une pause ; 5xx, réseau,
// réponse sans audio → nouvel essai ; 400/403/404 → échec franc.
import fs from 'node:fs';
import { MODELE_TTS, fichier } from './config.mjs';
import { requeteGemini } from './prod.mjs';
import { attendre, secret } from './outils.mjs';

let cles = null;
const clesEnPause = new Map();

/**
 * PAUSE COMMUNE. Le 429 « Resource has been exhausted » de la 3.8 vient par
 * VAGUES (saturation chez Google, pas un quota de nos clés : la même rafale
 * passe entière quelques minutes plus tard). Au premier refus, TOUS les appels
 * attendent ensemble — 15 s, puis plus longtemps si les refus se suivent
 * (jusqu'à 2 min) — au lieu d'insister chacun de leur côté.
 */
let pauseJusqua = 0;
let refusDeSuite = 0;
async function respecterLaPause() {
  for (;;) {
    const reste = pauseJusqua - Date.now();
    if (reste <= 0) return;
    await attendre(reste);
  }
}

function uneCle() {
  if (!cles) cles = secret('GEMINI_API_TTS_KEYS').split(',').map((c) => c.trim()).filter(Boolean);
  const maintenant = Date.now();
  const libres = cles.filter((c) => !(clesEnPause.get(c) > maintenant));
  const pool = libres.length > 0 ? libres : cles;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Essais d'une prise. Un 429 « Resource has been exhausted » de la 3.8 est une
 *  saturation passagère (les 82 clés répondent une par une) : on patiente. */
const ESSAIS = 20;

/** Une prise : `{ pcm: Int16Array, taux, jetons_entree, jetons_audio, essais }`. */
export async function priseGemini({ voix, texte, langue }) {
  const { corps } = requeteGemini({ voix, texte, langue });
  let derniere = '';
  for (let essai = 1; essai <= ESSAIS; essai++) {
    await respecterLaPause();
    const cle = uneCle();
    let rep;
    try {
      rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELE_TTS}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      derniere = `réseau : ${e?.message || e}`;
      await attendre(1000 * essai);
      continue;
    }
    if (rep.status === 429) {
      clesEnPause.set(cle, Date.now() + 60_000);
      const corps429 = await rep.text();
      // Journal des refus (heure, numéro de clé — jamais sa valeur) : sert à
      // trouver le rythme que Google tolère.
      fs.appendFileSync(fichier('cache', 'refus.log'), `${new Date().toISOString()} cle#${cles.indexOf(cle)}\n`);
      derniere = `HTTP 429 ${(/"message":\s*"([^"]{0,220})/.exec(corps429) || [])[1] || ''}`;
      refusDeSuite++;
      pauseJusqua = Math.max(pauseJusqua, Date.now() + Math.min(120_000, 15_000 * refusDeSuite) * (0.8 + 0.4 * Math.random()));
      continue;
    }
    if (!rep.ok) {
      const texteErreur = (await rep.text()).slice(0, 200);
      derniere = `HTTP ${rep.status} ${texteErreur}`;
      if (rep.status >= 500) { await attendre(1500 * essai); continue; }
      throw new Error(derniere);
    }
    refusDeSuite = 0;
    const json = await rep.json();
    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
    if (!part) {
      derniere = `réponse sans audio (${json?.candidates?.[0]?.finishReason || '?'})`;
      continue;
    }
    const taux = Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000;
    const octets = Buffer.from(part.inlineData.data, 'base64');
    // Copie alignée : un Buffer issu du pool peut commencer sur un octet impair.
    const pcm = new Int16Array(octets.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(octets.subarray(0, pcm.byteLength));
    return {
      pcm,
      taux,
      jetons_entree: json?.usageMetadata?.promptTokenCount || 0,
      jetons_audio: json?.usageMetadata?.candidatesTokenCount || 0,
      essais: essai,
    };
  }
  throw new Error(`échec après ${ESSAIS} essais : ${derniere}`);
}
