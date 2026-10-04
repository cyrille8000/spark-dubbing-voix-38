// L'appel Gemini 3.8 Flash TTS — la requête de la PROD (requeteGemini), les
// clés de la prod (Doppler GEMINI_API_TTS_KEYS, une par projet GCP, jamais
// affichées). Relances : 429 → une autre clé après une pause ; 5xx, réseau,
// réponse sans audio → nouvel essai ; 400/403/404 → échec franc.
import fs from 'node:fs';
import { MODELE_TTS, fichier } from './config.mjs';
import { pcmDuWav, requeteGemini } from './prod.mjs';
import { attendre, secret } from './outils.mjs';

/**
 * D'où partent les appels. Google FREINE ceux de ce poste (~10/min, rafales de
 * ~35 puis refus sur toutes les clés, mesuré le 2026-10-04) alors que la prod,
 * depuis Cloudflare, n'a aucun refus : `GEMINI_RELAIS` = le relais
 * outils/relais lancé en `wrangler dev --remote` (les appels partent de Cloudflare).
 */
const API_GEMINI = process.env.GEMINI_RELAIS || 'https://generativelanguage.googleapis.com';
/** Le mot de passe du relais (cache/relais.cle, jamais affiché). */
const ENTETE_RELAIS = process.env.GEMINI_RELAIS && fs.existsSync(fichier('cache', 'relais.cle'))
  ? { 'x-relais-cle': fs.readFileSync(fichier('cache', 'relais.cle'), 'utf8').trim() }
  : {};

let cles = null;
const clesEnPause = new Map();

/** Journal de CHAQUE requête (heure, durée, statut, langue, voix — jamais de
 *  clé) et corps des premiers refus : sert à comprendre les 429. */
let refusEnregistres = 0;
function noter(ligne) {
  fs.appendFileSync(fichier('cache', 'requetes.log'), `${ligne}\n`);
}

/** Le délai que Google demande dans un 429 (`"retryDelay": "12s"`), en ms. */
function delaiDemande(texte) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(texte || '');
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
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
    const cle = uneCle();
    const debut = Date.now();
    let rep;
    try {
      rep = await fetch(`${API_GEMINI}/v1beta/models/${MODELE_TTS}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cle, ...ENTETE_RELAIS },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      derniere = `réseau : ${e?.message || e}`;
      await attendre(1000 * essai);
      continue;
    }
    noter(`${new Date(debut).toISOString()} ${Date.now() - debut}ms ${rep.status} ${langue} ${voix} essai${essai} cle#${cles.indexOf(cle)}`);
    if (rep.status === 429) {
      clesEnPause.set(cle, Date.now() + 60_000);
      const corps429 = await rep.text();
      if (refusEnregistres++ < 5) {
        const entetes = [...rep.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
        const corpsMasque = corps429.replace(/AIza[0-9A-Za-z_-]+/g, '***');
        fs.appendFileSync(fichier('cache', 'refus_corps.txt'), `=== ${new Date().toISOString()}\n${entetes}\n\n${corpsMasque}\n\n`);
      }
      derniere = `HTTP 429 ${(/"message":\s*"([^"]{0,220})/.exec(corps429) || [])[1] || ''}`;
      await attendre(delaiDemande(corps429) ?? Math.min(60_000, 5000 * 2 ** (essai - 1)) * (0.5 + Math.random()));
      continue;
    }
    if (!rep.ok) {
      const texteErreur = (await rep.text()).slice(0, 200);
      derniere = `HTTP ${rep.status} ${texteErreur}`;
      if (rep.status >= 500) { await attendre(1500 * essai); continue; }
      throw new Error(derniere);
    }
    const json = await rep.json();
    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
    if (!part) {
      derniere = `réponse sans audio (${json?.candidates?.[0]?.finishReason || '?'})`;
      continue;
    }
    const brut = new Uint8Array(Buffer.from(part.inlineData.data, 'base64'));
    // Un WAV complet (Gemini 3.8) : le chunk `data` seul, comme la prod ;
    // sinon du PCM brut (audio/L16), au taux de son type MIME.
    const wav = pcmDuWav(brut);
    const octets = wav ? wav.pcm : brut;
    const taux = wav ? wav.sampleRate : (Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000);
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
