// Les deux workers de PROD lancés en local (`npx wrangler dev`) : spark-vad
// (TEN-VAD) et spark-edge-tts. Mêmes routes, même cadrage binaire qu'en prod.
import { VAD_URL, EDGE_URL } from './config.mjs';

/** [u32 LE longueur d'entête][entête JSON][octets collés] — le cadrage commun. */
function cadrer(entete, morceaux) {
  const e = new TextEncoder().encode(JSON.stringify(entete));
  const total = 4 + e.length + morceaux.reduce((a, m) => a + m.byteLength, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, e.length, true);
  out.set(e, 4);
  let off = 4 + e.length;
  for (const m of morceaux) { out.set(m, off); off += m.byteLength; }
  return out;
}

function decadrer(octets) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const n = dv.getUint32(0, true);
  const entete = JSON.parse(new TextDecoder().decode(octets.subarray(4, 4 + n)));
  return { entete, corps: octets.subarray(4 + n) };
}

/**
 * Durées parlées (secondes, silences ≥ 150 ms retirés) de PCM 16 bits mono —
 * `/detect-silences-batch`, exactement l'appel de la prod (sondes Edge et
 * `measure_speech` du worker TTS). Rend aussi les silences, pour rogner les extraits.
 */
export async function mesurerParole(pcms, tauxEchantillonnage = 24000) {
  const corps = cadrer({ lengths: pcms.map((p) => p.byteLength) }, pcms.map((p) => new Uint8Array(p.buffer, p.byteOffset, p.byteLength)));
  const rep = await fetch(`${VAD_URL}/detect-silences-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Sample-Rate': String(tauxEchantillonnage),
      'X-Format': 'pcm-i16-le',
      'X-Channels': '1',
    },
    body: corps,
  });
  const json = await rep.json();
  if (!rep.ok || !json.success) throw new Error(`spark-vad ${rep.status}: ${json.error || 'échec'}`);
  return json.results.map((r) => ({
    parle_s: r.duration_without_silences_s, total_s: r.total_duration_s, silences: r.silences,
  }));
}

/** Synthèse Edge de textes (au plus 40), par `/tts-batch` comme les sondes de la
 *  prod. Rend, dans l'ordre, `{ pcm: Int16Array, taux }` ou `{ erreur }`. */
export async function syntheseEdge(items) {
  const rep = await fetch(`${EDGE_URL}/tts-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, concurrency: 8 }),
  });
  if (!rep.ok) throw new Error(`spark-edge-tts ${rep.status}: ${(await rep.text()).slice(0, 200)}`);
  const { entete, corps } = decadrer(new Uint8Array(await rep.arrayBuffer()));
  let off = 0;
  return entete.items.map((r) => {
    if (!r.ok || !(r.len > 0)) return { erreur: r.error || 'échec Edge' };
    const octets = corps.slice(off, off + r.len);
    off += r.len;
    return { pcm: new Int16Array(octets.buffer, octets.byteOffset, octets.byteLength / 2), taux: entete.sample_rate };
  });
}
