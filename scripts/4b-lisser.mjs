// 4b. LE LISSAGE d'un ratios.json déjà assemblé, sans rien remesurer (4-assembler.mjs le fait aussi) :
// ratio = vitesse de la langue × vitesse de la voix (voir lib/lissage.mjs). Puis 5-vers-backend.mjs.
import { fichier } from './lib/config.mjs';
import { lisser, vitessesMesurees } from './lib/lissage.mjs';
import { ecrireJson, lireJson } from './lib/outils.mjs';

const ratios = lireJson(fichier('ratios.json'), null);
if (!ratios) throw new Error('ratios.json absent : lancer 4-assembler.mjs');
lisser(ratios, vitessesMesurees((l) => fichier('phrases_multiples', `${l}_mesure.json`), Object.keys(ratios.langues)));
ecrireJson(fichier('ratios.json'), ratios);

const ecarts = Object.values(ratios.langues).flatMap((e) => Object.values(e.voix).map((x) => Math.abs(x.ratio / x.ratio_mesure - 1)));
const plus5 = ecarts.filter((e) => e > 0.05).length;
console.log(`lissé : ${ecarts.length} ratios, ${plus5} bougent de plus de 5 %, au plus ${(100 * Math.max(...ecarts)).toFixed(1)} %`);
