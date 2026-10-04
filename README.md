# spark-dubbing-voix-38

Les 30 voix Gemini 3.8 du doublage, dans les 79 langues et variantes proposées :

- **les extraits d'écoute** du studio (`gemini/<langue>/<voix>.mp3`, catalogue `voices.json`) ;
- **la table des ratios de débit** (`ratios.json`) que le doublage lit au lieu de mesurer.

Tout est mesuré **en local avec le code de la prod**, jamais recopié quand il s'importe.

## Méthode

1. **Une phrase par langue** (`phrases.json`) : une phrase de taille moyenne traduite
   par le traducteur de la prod (OpenAI `gpt-6-luna`, effort bas).
2. **Référence Edge** (`edge.json`) : la phrase dite par la voix Edge de la langue
   (celle que le doublage sonde pour tout locuteur gemini), texte nettoyé comme les sondes.
3. **Prises Gemini** : chaque voix lit la phrase 3 fois, avec **la requête du doublage**
   (`buildGeminiApiRequest` de la prod : tiret de continuation, minuscule,
   style `no filler words, no non-verbal sounds`, `languageCode`).
4. **Durées parlées** par le TEN-VAD de la prod, silences de 150 ms et plus retirés
   des deux côtés. Edge : le worker `spark-vad` lancé en local. Gemini : le même
   `vad.js` et le même `ten_vad.wasm` dans Node, sur plusieurs fils
   (`scripts/verifier-vad.mjs` vérifie la parité : résultats identiques).
5. **Ratio** = médiane des 3 prises de (parlé Gemini ÷ parlé Edge). L'extrait d'écoute
   est la prise médiane, rognée de ses silences de tête et de queue.

## Lancer

Les workers de prod en local (depuis `backend/cloudflare/workers`) :

```bash
cd spark-vad && npx wrangler dev --port 8990
cd spark-edge-tts && npx wrangler dev --port 8991
```

Puis, depuis ce dépôt (Doppler connecté ; les clés ne s'affichent jamais) :

```bash
node scripts/1-phrases.mjs      # phrases.json
node scripts/2-edge.mjs         # edge.json
node scripts/3-gemini.mjs       # cache/ : prises WAV + journal (reprend où il s'est arrêté)
node scripts/4-assembler.mjs    # ratios.json, voices.json, gemini/*.mp3
node scripts/5-vers-backend.mjs # copie la table dans backend/.../shared/ratios-gemini/
```

`3-gemini.mjs --a-blanc` montre la requête exacte sans appeler. Google renvoie des 429
par vagues : le script fait une pause commune, et relancer reprend les prises manquantes.
