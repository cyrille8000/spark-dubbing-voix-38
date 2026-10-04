// PARITÉ : le TEN-VAD lancé dans Node (lib/vad-node.mjs) doit rendre
// EXACTEMENT ce que rend le worker spark-vad (wrangler dev), sur les mêmes
// prises. À relancer après toute mise à jour de spark-vad.
import fs from 'node:fs';
import { fichier } from './lib/config.mjs';
import { mesurerParole } from './lib/services.mjs';
import { mesurerParoleNode } from './lib/vad-node.mjs';

const dossier = fichier('cache', 'prises', 'fr');
const wavs = fs.readdirSync(dossier).filter((f) => f.endsWith('.wav')).slice(0, Number(process.argv[2] || 12));
let ecarts = 0;
for (const f of wavs) {
  const b = fs.readFileSync(`${dossier}/${f}`);
  const pcm = new Int16Array((b.length - 44) >> 1);
  new Uint8Array(pcm.buffer).set(b.subarray(44, 44 + pcm.byteLength));
  const taux = b.readUInt32LE(24);
  const [w] = await mesurerParole([pcm], taux);
  const n = await mesurerParoleNode(pcm, taux);
  const identique = w.parle_s === n.parle_s && w.total_s === n.total_s && JSON.stringify(w.silences) === JSON.stringify(n.silences);
  if (!identique) ecarts++;
  console.log(`${f.padEnd(22)} worker ${w.parle_s.toFixed(6)} s | node ${n.parle_s.toFixed(6)} s | ${identique ? 'IDENTIQUE' : 'ÉCART'}`);
}
console.log(ecarts === 0 ? `${wavs.length}/${wavs.length} identiques` : `${ecarts} ÉCART(S)`);
process.exit(ecarts === 0 ? 0 : 1);
