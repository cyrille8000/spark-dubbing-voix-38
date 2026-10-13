// 1. LA PHRASE DE CHAQUE LANGUE — une phrase de taille moyenne (complète,
// ~100 caractères en anglais, deux virgules), traduite dans chaque langue et
// variante proposée par le traducteur de la prod (OpenAI, effort bas). Écrit
// phrases.json ; une langue déjà traduite est gardée (--refaire fr,es pour la
// refaire).
import { MODELE_TRADUCTION, fichier } from './lib/config.mjs';
import { LANGUES } from './lib/prod.mjs';
import { ecrireJson, enParallele, lireJson, liste, options, secret } from './lib/outils.mjs';
import { traduirePhrase } from './lib/traduction.mjs';

export const SOURCE = 'Honestly, I didn’t expect much from this place, but the food was delicious and the staff were really kind.';

const opts = options();
const refaire = liste(opts.refaire);
const chemin = fichier('phrases.json');
const doc = lireJson(chemin, { source: SOURCE, modele: MODELE_TRADUCTION, langues: {} });
if (doc.source !== SOURCE) throw new Error('phrases.json a été traduit depuis une autre phrase : effacez-le pour recommencer');

const cle = secret('OPENAI_API_KEY');

const traduire = (l) => traduirePhrase(cle, l, SOURCE);

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
