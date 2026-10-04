// Ce que la PROD fait, importé de son code (jamais recopié quand c'est
// importable) : langues proposées, 30 voix, requête Gemini 3.8.
import fs from 'node:fs';
import path from 'node:path';
import { WORKERS, prod } from './config.mjs';

const catalogue = JSON.parse(fs.readFileSync(path.join(WORKERS, 'shared/langues/langues.json'), 'utf8'));

/** Les langues et variantes PROPOSÉES par la gamme gemini (champ `proposee`,
 *  le même filtre que le front : `LANGUES_GEMINI_38`). */
export const LANGUES = catalogue.langues.filter((l) => l.proposee);

/** La voix Edge de référence d'une langue — `defaultEdgeVoiceFor` de la prod :
 *  pour la gamme gemini, la même pour tous les locuteurs. */
export const voixEdge = (langue) => langue.edge || 'en-US-EmmaMultilingualNeural';

export const { GEMINI_VOICES } = await import(prod('shared/voice-catalog-js/index.js'));
export const { buildGeminiApiRequest } = await import(prod('spark-gemini-flash-tts/src/lib/gemini-api-prompt.js'));

/**
 * Le texte envoyé à Edge — `nettoyerTexteSonde` de
 * spark-dubbing-api/src/utils/edge-ref-probe.js (non exportée, et ce module
 * tire toute la conso du worker) : MÊMES remplacements, dans le même ordre.
 */
export function texteEdge(text) {
  return text
    .replaceAll('—', ' ')
    .replaceAll('...', ' ')
    .replaceAll('…', ' ')
    .replaceAll('«', '')
    .replaceAll('»', '')
    .replaceAll(' ', ' ')
    .replaceAll(' ', ' ');
}

/** La requête Gemini 3.8 d'un segment de doublage (calibrage : texte seul, sans
 *  ton, `standalone_take` absent), construite par la fonction de la prod. Les
 *  drapeaux Doppler `TTS_NO_NONVERBAL` et `TTS_PREPEND_CONTINUATION_DASH` sont
 *  absents ou à true en prod : `env` vide = leurs valeurs. */
export function requeteGemini({ voix, texte, langue }) {
  const r = buildGeminiApiRequest({ env: {}, speechParts: [{ text: texte, emotion_tags: [] }], language: langue });
  return {
    corps: {
      contents: [{ role: 'user', parts: r.parts }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voix } },
          ...(r.languageCode ? { languageCode: r.languageCode } : {}),
        },
      },
    },
    transcript: r.transcript,
  };
}
