// LE LISSAGE DE LA TABLE (décision du propriétaire, 2026-10-11).
//
// POURQUOI. Chaque ratio brut vient d'UNE phrase par langue, lue 3 fois par la voix : ses trois lectures
// vont dans le même sens quand la voix a lu CETTE phrase vite ou lentement. Constaté en vrai le
// 2026-10-11 : thaï, voix Sadachbia, ratio brut 0,79 (lectures 0,78 à 0,81) quand sa vitesse habituelle
// donne 0,85 et que son doublage réel mesure ~0,92 → texte prévu trop court, audio accéléré jusqu'à
// ×1,37. Or les voix Gemini parlent presque toutes au même train (0,96 à 1,04 l'une de l'autre, toutes
// langues confondues) : l'écart d'un couple (voix, langue) à « vitesse de la langue × vitesse de la
// voix » est surtout du bruit de la phrase (médiane 3 %, 90e centile 8 %, jusqu'à 18 %).
//
// LE CALCUL. Médianes croisées sur toute la table (median polish) : vitesse de chaque langue =
// médiane, sur ses voix, de (ratio brut ÷ vitesse de la voix) ; vitesse de chaque voix = médiane, sur
// les langues, de (ratio brut ÷ vitesse de la langue) ; quelques tours, puis les voix ramenées autour
// de 1. Ratio LISSÉ = vitesse de la langue × vitesse de la voix — c'est lui que le doublage lit
// (`ratio`) ; la mesure brute reste à côté (`ratio_mesure`). Relancer est sans effet : on repart
// toujours de `ratio_mesure` quand il existe.
//
// CE QUE ÇA NE CORRIGE PAS : la phrase d'une langue qui se dit, avec toutes les voix, plus vite ou
// plus lentement qu'un texte ordinaire (japonais ~ −6 %, mesuré le 2026-10-11). Une langue MESURÉE sur
// plusieurs phrases (6-mesure-langue.mjs, appels payants) garde sa vitesse mesurée à la place :
// le thaï depuis le 2026-10-11 (30 répliques × 3 voix).

import fs from 'node:fs';

const TOURS = 6;

const mediane = (xs) => {
  const t = [...xs].sort((a, b) => a - b);
  const k = t.length >> 1;
  return t.length % 2 ? t[k] : (t[k - 1] + t[k]) / 2;
};

const arrondi = (x) => Number(x.toFixed(4));

/**
 * Les vitesses de langue MESURÉES sur plusieurs phrases (6-mesure-langue.mjs → phrases_multiples/
 * <langue>_mesure.json) : `{ th: 0.77, … }`. Elles remplacent la vitesse tirée de la phrase unique.
 */
export function vitessesMesurees(fichierDe, langues) {
  const out = {};
  for (const l of langues) {
    const chemin = fichierDe(l);
    try {
      const m = JSON.parse(fs.readFileSync(chemin, 'utf8'));
      if (m.vitesse_langue > 0) out[l] = m.vitesse_langue;
    } catch { /* pas de mesure pour cette langue */ }
  }
  return out;
}

/**
 * Lisse `ratios` (le format de ratios.json) en place et le rend. `mesurees` : les vitesses de langue
 * mesurées sur plusieurs phrases (vitessesMesurees) ; elles priment sur la phrase unique.
 */
export function lisser(ratios, mesurees = {}) {
  const langues = Object.keys(ratios.langues).filter((l) => Object.keys(ratios.langues[l].voix || {}).length);
  const brut = (l, v) => {
    const x = ratios.langues[l].voix[v];
    return x.ratio_mesure ?? x.ratio;
  };
  const voix = [...new Set(langues.flatMap((l) => Object.keys(ratios.langues[l].voix)))];
  const vitesseLangue = Object.fromEntries(langues.map((l) => [l, 1]));
  const vitesseVoix = Object.fromEntries(voix.map((v) => [v, 1]));
  for (let tour = 0; tour < TOURS; tour++) {
    for (const l of langues) {
      vitesseLangue[l] = mediane(Object.keys(ratios.langues[l].voix).map((v) => brut(l, v) / vitesseVoix[v]));
    }
    for (const v of voix) {
      vitesseVoix[v] = mediane(langues.filter((l) => ratios.langues[l].voix[v]).map((l) => brut(l, v) / vitesseLangue[l]));
    }
  }
  // Les voix autour de 1 : la langue porte l'échelle (le produit ne change pas).
  const centre = mediane(Object.values(vitesseVoix));
  for (const v of voix) vitesseVoix[v] /= centre;
  for (const l of langues) vitesseLangue[l] *= centre;
  // Une langue mesurée sur plusieurs phrases garde SA mesure (déjà ramenée aux vitesses des voix).
  const mesure = {};
  for (const [l, v] of Object.entries(mesurees)) {
    if (vitesseLangue[l] && v > 0) { vitesseLangue[l] = v; mesure[l] = true; }
  }

  for (const l of langues) {
    const entree = ratios.langues[l];
    entree.vitesse_langue = arrondi(vitesseLangue[l]);
    if (mesure[l]) entree.vitesse_mesuree = true; else delete entree.vitesse_mesuree;
    for (const v of Object.keys(entree.voix)) {
      const x = entree.voix[v];
      x.ratio_mesure = arrondi(brut(l, v));
      x.ratio = arrondi(vitesseLangue[l] * vitesseVoix[v]);
    }
  }
  ratios.vitesses_voix = Object.fromEntries(voix.map((v) => [v, arrondi(vitesseVoix[v])]));
  ratios.lissage = 'ratio = vitesse de la langue × vitesse de la voix (médianes croisées sur toute la table, 2026-10-11) ; '
    + 'mesure brute dans ratio_mesure ; vitesse_mesuree = langue mesurée sur plusieurs phrases (phrases_multiples)';
  return ratios;
}
