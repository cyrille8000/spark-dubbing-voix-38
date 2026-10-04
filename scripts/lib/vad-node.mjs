// LE TEN-VAD DE LA PROD, dans Node et sur plusieurs fils.
//
// Pourquoi : `wrangler dev` fait tourner spark-vad sur UN fil, ~3,5 s par prise
// — 7 110 prises y feraient la queue des heures (et le worker local finit par
// répondre 503). Ici, le MÊME `spark-vad/src/vad.js` et le MÊME
// `ten_vad.wasm` sont importés tels quels (crochet ./wasm-loader.mjs), et la
// conversion PCM est celle de `payloadToMonoFloat32` (index.js, i16 mono :
// v / 32768). La parité avec le worker est vérifiée par `verifier-vad.mjs`.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { register } from 'node:module';
import os from 'node:os';
import { prod } from './config.mjs';

if (!isMainThread) {
  register('./wasm-loader.mjs', import.meta.url);
  const { detectSilences } = await import(prod('spark-vad/src/vad.js'));
  parentPort.on('message', async ({ id, octets, taux }) => {
    try {
      const pcm = new Int16Array(octets);
      const samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
      const r = await detectSilences(samples, taux);
      parentPort.postMessage({
        id,
        resultat: {
          parle_s: r.duration_without_silences_s, total_s: r.total_duration_s,
          silences: r.silences.map(([s, e]) => [s, e]),
        },
      });
    } catch (e) {
      parentPort.postMessage({ id, erreur: String(e?.message || e) });
    }
  });
}

let pool = null;
let prochain = 0;
const enAttente = new Map();

function demarrer() {
  const n = Math.max(1, Number(process.env.VAD_FILS || Math.min(8, os.cpus().length - 1)));
  pool = Array.from({ length: n }, () => {
    const w = new Worker(new URL(import.meta.url));
    w.on('message', ({ id, resultat, erreur }) => {
      const p = enAttente.get(id);
      enAttente.delete(id);
      if (erreur) p.reject(new Error(`TEN-VAD : ${erreur}`)); else p.resolve(resultat);
    });
    return w;
  });
}

let compteur = 0;
/** Durée parlée d'un PCM 16 bits mono — même calcul que `/detect-silences-batch`. */
export function mesurerParoleNode(pcm, taux) {
  if (!pool) demarrer();
  const id = ++compteur;
  const copie = pcm.slice().buffer;
  return new Promise((resolve, reject) => {
    enAttente.set(id, { resolve, reject });
    pool[prochain++ % pool.length].postMessage({ id, octets: copie, taux }, [copie]);
  });
}

/** Arrête les fils (fin de script). */
export async function fermerVad() {
  if (!pool) return;
  await Promise.all(pool.map((w) => w.terminate()));
  pool = null;
}
