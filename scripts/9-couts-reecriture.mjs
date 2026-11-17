// 9. LE COÛT DES RÉÉCRITURES (LLM), MESURÉ (2026-11-17) — la contrepartie « texte » de 8-couts-estimation.mjs.
// Les prompts EXACTS de la prod (`build_variation_messages` de spark-adjust-evaluator, écrits par un test Rust
// temporaire dans `--prompts`) : 60 langues × 6 textes × raccourcir/allonger, envoyés comme la prod (system + user,
// `reasoning_effort` low, le modèle OPENAI_MODEL_REFINE). Seuls les jetons sont gardés (cache/couts-reecriture.jsonl,
// en ajout — un lancement interrompu reprend). La clé OpenAI de la prod est lue dans Doppler, jamais affichée.
//   --prompts <fichier.json>   --a-blanc (montre la requête d'un prompt, ne paie rien)
import fs from 'node:fs';
import { fichier } from './lib/config.mjs';
import { enParallele, options, secret } from './lib/outils.mjs';

const opts = options();
const prompts = JSON.parse(fs.readFileSync(opts.prompts, 'utf8'));
const MODELE = process.env.OPENAI_MODEL_REFINE || 'gpt-6-luna';
const journal = fichier('cache', 'couts-reecriture.jsonl');
const cleDe = (p) => [p.lang, p.sorte, p.op].join('|');
const faites = new Set(fs.existsSync(journal)
  ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map((l) => cleDe(JSON.parse(l)))
  : []);
const restants = prompts.filter((p) => !faites.has(cleDe(p)));

const corps = (p) => ({
  model: MODELE,
  messages: [...(p.system ? [{ role: 'system', content: p.system }] : []), { role: 'user', content: p.user }],
  reasoning_effort: 'low',
  max_completion_tokens: 16000,
});

if (opts['a-blanc']) {
  const c = corps(prompts[0]);
  console.log(`${prompts.length} réécritures, ${restants.length} à faire ; modèle ${MODELE}`);
  console.log(JSON.stringify({ ...c, messages: c.messages.map((m) => ({ role: m.role, content: `${m.content.slice(0, 300)}… (${m.content.length} car.)` })) }, null, 2));
  process.exit(0);
}

const cle = secret('OPENAI_API_KEY');
let faitesIci = 0;
await enParallele(restants.map((p) => async () => {
  for (let essai = 1; essai <= 6; essai++) {
    const rep = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corps(p)),
    }).catch(() => null);
    if (rep?.ok) {
      const u = (await rep.json()).usage || {};
      const ligne = {
        lang: p.lang, sorte: p.sorte, op: p.op, caracteres: p.caracteres,
        entree: u.prompt_tokens || 0, cache: u.prompt_tokens_details?.cached_tokens || 0,
        sortie: u.completion_tokens || 0, reflexion: u.completion_tokens_details?.reasoning_tokens || 0,
      };
      fs.appendFileSync(journal, `${JSON.stringify(ligne)}\n`);
      faitesIci += 1;
      if (faitesIci % 50 === 0) console.log(`${faitesIci}/${restants.length}`);
      return ligne;
    }
    await new Promise((r) => setTimeout(r, 1500 * essai));
  }
  throw new Error(`échec : ${cleDe(p)}`);
}), 16);
console.log(`fini : ${faitesIci} réécritures`);
