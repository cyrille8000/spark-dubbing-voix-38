// 2. LA RÉFÉRENCE EDGE DE CHAQUE LANGUE — la phrase dite par la voix Edge de
// la langue (celle de la prod pour tout locuteur gemini), texte nettoyé comme
// les sondes de la prod, durée parlée par le TEN-VAD de la prod. Edge est
// déterministe : une lecture suffit. Écrit edge.json.
import { fichier } from './lib/config.mjs';
import { LANGUES, texteEdge, voixEdge } from './lib/prod.mjs';
import { mesurerParole, syntheseEdge } from './lib/services.mjs';
import { ecrireJson, lireJson } from './lib/outils.mjs';

const phrases = lireJson(fichier('phrases.json'), null);
if (!phrases) throw new Error('phrases.json absent : lancer 1-phrases.mjs');

const entrees = LANGUES.map((l) => ({
  code: l.code, voix: voixEdge(l), texte: texteEdge(phrases.langues[l.code].texte),
}));
const resultat = { genere_le: new Date().toISOString(), langues: {} };

// Lots de 20 (le format des sondes de la prod).
for (let i = 0; i < entrees.length; i += 20) {
  const lot = entrees.slice(i, i + 20);
  const audios = await syntheseEdge(lot.map((e) => ({ text: e.texte, voice: e.voix })));
  const ok = audios.map((a, k) => ({ a, e: lot[k] })).filter(({ a }) => a.pcm);
  const mesures = ok.length ? await mesurerParole(ok.map(({ a }) => a.pcm), ok[0].a.taux) : [];
  ok.forEach(({ e }, k) => {
    resultat.langues[e.code] = { voix_edge: e.voix, texte_edge: e.texte, edge_s: mesures[k].parle_s, total_s: mesures[k].total_s };
    console.log(`${e.code.padEnd(7)} ${e.voix.padEnd(32)} parlé ${mesures[k].parle_s.toFixed(3)} s / total ${mesures[k].total_s.toFixed(3)} s`);
  });
  audios.forEach((a, k) => { if (!a.pcm) console.log(`${lot[k].code} ÉCHEC ${a.erreur}`); });
}

ecrireJson(fichier('edge.json'), resultat);
const manquantes = LANGUES.filter((l) => !resultat.langues[l.code]).map((l) => l.code);
console.log(manquantes.length ? `MANQUANTES : ${manquantes.join(', ')}` : `${LANGUES.length} langues mesurées`);
