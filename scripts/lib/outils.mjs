// Petites briques : secrets Doppler (jamais affichés), pool parallèle, JSON.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Un secret de Doppler (prd_cloudflare-workers). Jamais écrit ni journalisé. */
export function secret(nom) {
  const v = execFileSync('doppler', ['secrets', 'get', nom, '-p', 'dubbingspark', '-c', 'prd_cloudflare-workers', '--plain'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32',
  }).trim();
  if (!v) throw new Error(`secret ${nom} absent`);
  return v;
}

/** Exécute `taches` avec au plus `n` en vol ; rend les résultats dans l'ordre. */
export async function enParallele(taches, n, surFin) {
  const resultats = new Array(taches.length);
  let suivant = 0;
  let finies = 0;
  const ouvrier = async () => {
    while (suivant < taches.length) {
      const i = suivant++;
      try {
        resultats[i] = await taches[i]();
      } catch (e) {
        resultats[i] = { erreur: String(e?.message || e) };
      }
      finies++;
      if (surFin) surFin(finies, taches.length, resultats[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, taches.length) }, ouvrier));
  return resultats;
}

export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

export function lireJson(chemin, defaut) {
  try { return JSON.parse(fs.readFileSync(chemin, 'utf8')); } catch { return defaut; }
}

export function ecrireJson(chemin, valeur) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const tmp = `${chemin}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(valeur, null, 2)}\n`);
  fs.renameSync(tmp, chemin);
}

/** Options `--cle valeur` de la ligne de commande. */
export function options() {
  const o = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const cle = a[i].slice(2);
      o[cle] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    }
  }
  return o;
}

/** Filtre « fr,es-us » d'une option en ensemble (vide = tout). */
export const liste = (v) => new Set(String(v || '').split(',').map((s) => s.trim()).filter(Boolean));
