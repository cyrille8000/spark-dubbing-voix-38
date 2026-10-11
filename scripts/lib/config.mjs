// Réglages communs. Le dossier des workers de prod est lu tel quel : les
// langues, les voix et la requête Gemini viennent de LA source de la prod.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const RACINE = fileURLToPath(new URL('../../', import.meta.url));
export const WORKERS = process.env.BACKEND_WORKERS
  || path.resolve(RACINE, '../backend/cloudflare/workers');
export const ANCIEN_DEPOT = process.env.ANCIEN_DEPOT
  || path.resolve(RACINE, '../spark-dubbing-voices');

/** Un module des workers de prod, importable par Node. */
export const prod = (relatif) => pathToFileURL(path.join(WORKERS, relatif)).href;

export const MODELE_TTS = process.env.GEMINI_API_TTS_MODEL || 'gemini-3.8-flash-tts';
/** Le traducteur de la prod (spark-translator : OPENAI_MODEL_TRANSLATION, effort bas). */
export const MODELE_TRADUCTION = process.env.OPENAI_MODEL_TRANSLATION || 'gpt-6-luna';
/** Lectures de la phrase par voix et par langue ; le ratio = la médiane. */
export const PRISES = Number(process.env.PRISES || 3);

// Les workers de prod lancés en local (`npx wrangler dev`, voir README).
export const VAD_URL = process.env.VAD_URL || 'http://127.0.0.1:8990';
export const EDGE_URL = process.env.EDGE_URL || 'http://127.0.0.1:8991';
/** spark-duree (l'estimation de la durée parlée, référence des ratios depuis le 2026-10-11). */
export const DUREE_URL = process.env.DUREE_URL || 'http://127.0.0.1:8797';

/** Appels Gemini en vol en même temps. */
export const EN_PARALLELE = Number(process.env.EN_PARALLELE || 32);

export const fichier = (...p) => path.join(RACINE, ...p);
