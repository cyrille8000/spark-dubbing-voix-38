// 2. LA RÉFÉRENCE DE CHAQUE LANGUE — depuis le 2026-10-11, l'ESTIMATION de la durée parlée de la phrase
// par spark-duree (Edge TTS est coupé depuis le 2026-10-10) : le même Worker, le même texte que le
// doublage lui envoie (la phrase NETTOYÉE comme les sondes de la prod : nettoyerTexteSonde, ici
// texteEdge). Déterministe : un appel suffit. Écrit duree.json.
//
// Le Worker lancé en local (backend/cloudflare/workers/spark-duree : `npx wrangler dev --port 8797`, et
// pour le japonais et le thaï le serveur de containers/spark-phonemes ; voir son WORKER.md).
import { DUREE_URL, fichier } from './lib/config.mjs';
import { LANGUES, texteEdge } from './lib/prod.mjs';
import { ecrireJson, lireJson } from './lib/outils.mjs';

const phrases = lireJson(fichier('phrases.json'), null);
if (!phrases) throw new Error('phrases.json absent : lancer 1-phrases.mjs');

const resultat = { genere_le: new Date().toISOString(), estimateur: 'spark-duree', langues: {} };
for (const l of LANGUES) {
  const texte = texteEdge(phrases.langues[l.code].texte);
  const r = await fetch(`${DUREE_URL}/estimer`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ langue: l.code, textes: [texte] }),
  });
  const corps = await r.json();
  if (r.status !== 200) {
    console.log(`${l.code.padEnd(7)} ÉCHEC HTTP ${r.status} : ${corps.erreur}`);
    continue;
  }
  resultat.langues[l.code] = { texte, duree_s: corps.durees[0] };
  console.log(`${l.code.padEnd(7)} ${corps.durees[0].toFixed(3)} s`);
}

ecrireJson(fichier('duree.json'), resultat);
const manquantes = LANGUES.filter((l) => !resultat.langues[l.code]).map((l) => l.code);
console.log(manquantes.length ? `MANQUANTES : ${manquantes.join(', ')}` : `${LANGUES.length} langues estimées`);
