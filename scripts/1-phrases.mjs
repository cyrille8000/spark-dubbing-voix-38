// 1. LA PHRASE DE CHAQUE LANGUE — une phrase de taille moyenne (complète,
// ~100 caractères en anglais, deux virgules), traduite dans chaque langue et
// variante proposée par le traducteur de la prod (OpenAI, effort bas). Écrit
// phrases.json ; une langue déjà traduite est gardée (--refaire fr,es pour la
// refaire).
import { MODELE_TRADUCTION, fichier } from './lib/config.mjs';
import { LANGUES } from './lib/prod.mjs';
import { ecrireJson, enParallele, lireJson, liste, options, secret } from './lib/outils.mjs';

export const SOURCE = 'Honestly, I didn’t expect much from this place, but the food was delicious and the staff were really kind.';

/** Précisions d'écriture pour les variétés où « le système d'écriture usuel »
 *  laisse un doute. */
const ECRITURE = {
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

const opts = options();
const refaire = liste(opts.refaire);
const chemin = fichier('phrases.json');
const doc = lireJson(chemin, { source: SOURCE, modele: MODELE_TRADUCTION, langues: {} });
if (doc.source !== SOURCE) throw new Error('phrases.json a été traduit depuis une autre phrase : effacez-le pour recommencer');

const cle = secret('OPENAI_API_KEY');

async function traduire(l) {
  const ecriture = ECRITURE[l.code] ? ` Write it in ${ECRITURE[l.code]}.` : ' Write it in the usual writing system of that language.';
  const rep = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cle}` },
    body: JSON.stringify({
      model: MODELE_TRADUCTION,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'You are a professional translator for video dubbing.' },
        {
          role: 'user',
          content: `Translate this sentence into ${l.en}. Say it exactly as a native speaker of this variety would naturally say it out loud in a video.${ecriture} Keep one sentence, the same meaning and tone, and end it with a period (or the full stop of that script). Reply with the translation only, no quotes, no notes.\n\n${SOURCE}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await rep.json();
  if (!rep.ok) throw new Error(`OpenAI ${rep.status}: ${json?.error?.message || '?'}`);
  const texte = String(json.choices?.[0]?.message?.content || '').trim().replace(/^["“«]+|["”»]+$/g, '').trim();
  if (!texte) throw new Error('traduction vide');
  return texte;
}

const aFaire = LANGUES.filter((l) => !doc.langues[l.code] || refaire.has(l.code));
console.log(`${LANGUES.length} langues proposées, ${aFaire.length} à traduire (${MODELE_TRADUCTION})`);
await enParallele(aFaire.map((l) => async () => {
  const texte = await traduire(l);
  doc.langues[l.code] = { nom: l.en, texte };
  ecrireJson(chemin, doc);
  return texte;
}), 8, (n, total, r) => console.log(`${n}/${total} ${r?.erreur ? `ÉCHEC ${r.erreur}` : r}`));

const manquantes = LANGUES.filter((l) => !doc.langues[l.code]).map((l) => l.code);
console.log(manquantes.length ? `MANQUANTES : ${manquantes.join(', ')}` : 'toutes les langues ont leur phrase');
