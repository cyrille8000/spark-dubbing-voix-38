// LA TRADUCTION D'UNE PHRASE par le traducteur de la prod (OpenAI, effort bas) —
// commune à 1-phrases.mjs (la phrase de la table Gemini) et à 7-phrases-ratio.mjs
// (les 4 phrases du ratio des gammes à clé).
import { MODELE_TRADUCTION } from './config.mjs';

/** Précisions d'écriture pour les variétés où « le système d'écriture usuel »
 *  laisse un doute. */
export const ECRITURE = {
  yue: 'written colloquial Cantonese (Hong Kong), in Traditional Chinese characters',
  'cmn-tw': 'Traditional Chinese characters, as used in Taiwan',
  cmn: 'Simplified Chinese characters',
  'ar-eg': 'colloquial Egyptian Arabic, in Arabic script',
  ar: 'Modern Standard Arabic, in Arabic script',
  prs: 'Dari as spoken in Afghanistan, in Perso-Arabic script',
  nn: 'Nynorsk, not Bokmål',
  'es-us': 'Latin American Spanish',
  'pt-pt': 'European Portuguese (Portugal), not Brazilian',
  'fr-ca': 'Canadian French (Québec)',
};

/** Le corps de la requête OpenAI qui traduit `source` dans la langue `l`. */
export function requeteTraduction(l, source) {
  const ecriture = ECRITURE[l.code] ? ` Write it in ${ECRITURE[l.code]}.` : ' Write it in the usual writing system of that language.';
  return {
    model: MODELE_TRADUCTION,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: 'You are a professional translator for video dubbing.' },
      {
        role: 'user',
        content: `Translate this sentence into ${l.en}. Say it exactly as a native speaker of this variety would naturally say it out loud in a video.${ecriture} Keep one sentence, the same meaning and tone, and end it with a period (or the full stop of that script). Reply with the translation only, no quotes, no notes.\n\n${source}`,
      },
    ],
  };
}

/** Traduit `source` dans la langue `l` (clé OpenAI `cle`). */
export async function traduirePhrase(cle, l, source) {
  const rep = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cle}` },
    body: JSON.stringify(requeteTraduction(l, source)),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await rep.json();
  if (!rep.ok) throw new Error(`OpenAI ${rep.status}: ${json?.error?.message || '?'}`);
  const texte = String(json.choices?.[0]?.message?.content || '').trim().replace(/^["“«]+|["”»]+$/g, '').trim();
  if (!texte) throw new Error('traduction vide');
  return texte;
}
