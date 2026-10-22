# spark-dubbing-voix-38

Les 30 voix Gemini 3.8 du doublage :

- **les extraits d'écoute** du studio (`gemini/<langue>/<voix>.mp3`, catalogue `voices.json`),
  85 langues et variantes ;
- **la table des ratios de débit** (`ratios.json`) que le doublage lit au lieu de mesurer,
  60 langues depuis le 2026-10-22 (celles que spark-duree estime ; 54 du 2026-10-11 au 2026-10-22, 79 avant).

Tout est mesuré **en local avec le code de la prod**, jamais recopié quand il s'importe.

## Méthode

1. **Une phrase par langue** (`phrases.json`) : une phrase de taille moyenne traduite
   par le traducteur de la prod (OpenAI `gpt-6-luna`, effort bas).
2. **Référence** (`duree.json`, depuis le 2026-10-11) : la durée parlée de la phrase
   ESTIMÉE par le Worker `spark-duree` — l'estimation que le doublage fait pour toute
   sonde depuis que Microsoft a coupé Edge (2026-10-10) —, texte nettoyé comme les
   sondes. 60 langues. Avant : la phrase dite par la voix Edge de la langue (`edge.json`,
   gardé pour mémoire).
3. **Prises Gemini** : chaque voix lit la phrase 3 fois, avec **la requête du doublage**
   (`buildGeminiApiRequest` de la prod : tiret de continuation, minuscule,
   style `no filler words, no non-verbal sounds`, `languageCode`).
4. **Durées parlées** des prises par le TEN-VAD de la prod, silences de 150 ms et plus
   retirés : le même `vad.js` et le même `ten_vad.wasm` dans Node, sur plusieurs fils
   (`scripts/verifier-vad.mjs` vérifie la parité : résultats identiques).
5. **Ratio** = médiane des 3 prises de (parlé Gemini ÷ durée estimée). L'extrait d'écoute
   est la prise médiane, rognée de ses silences de tête et de queue. Changer de
   référence ne coûte rien : les prises sont dans `cache/`, seul le dénominateur change.
6. **Lissage** (depuis le 2026-10-11, `scripts/lib/lissage.mjs`) : le doublage lit
   `ratio = vitesse de la langue × vitesse de la voix`, deux médianes croisées sur toute
   la table ; la médiane brute des prises reste en `ratio_mesure`. Une seule phrase par
   langue : quand une voix lit CETTE phrase vite, ses 3 prises vont dans le même sens
   (thaï, Sadachbia : 0,79 brut, 0,85 lissé, ~0,92 en vrai doublage).

## Lancer

Les workers de prod en local (depuis `backend/cloudflare/workers`) :

```bash
cd spark-duree && npx wrangler dev --port 8797
```

(Pour le japonais et le thaï, le serveur de `containers/spark-phonemes` aussi : voir le
`WORKER.md` de spark-duree.)

Puis, depuis ce dépôt (Doppler connecté ; les clés ne s'affichent jamais) :

```bash
node scripts/1-phrases.mjs      # phrases.json
node scripts/2-duree.mjs        # duree.json (2-edge.mjs : l'ancienne référence Edge)
node scripts/3-gemini.mjs       # cache/ : prises WAV + journal (reprend où il s'est arrêté)
node scripts/4-assembler.mjs    # ratios.json (lissé), voices.json, gemini/*.mp3
node scripts/4b-lisser.mjs      # (seul) relisser un ratios.json existant, sans rien remesurer
node scripts/5-vers-backend.mjs # copie la table dans backend/.../shared/ratios-gemini/
```

Une langue dont la phrase unique ne représente pas un texte ordinaire se mesure sur plusieurs
phrases (`phrases_multiples/<langue>.json`, N phrases × quelques voix × 1 prise, appels payants :
montrer la requête avec `--a-blanc` d'abord) ; sa vitesse mesurée remplace alors celle de la phrase
unique au lissage :

```bash
node scripts/6-mesure-langue.mjs --langue th --voix Sadachbia,Laomedeia,Iapetus --a-blanc
node scripts/6-mesure-langue.mjs --langue th --voix Sadachbia,Laomedeia,Iapetus            # les prises
node scripts/6-mesure-langue.mjs --langue th --voix Sadachbia,Laomedeia,Iapetus --estimer  # la vitesse
```

Fait pour le thaï le 2026-10-11 : 30 répliques (7 d'un vrai doublage, leurs morceaux, des phrases de
Wikipédia) × 3 voix, ~0,10 $ ; vitesse 0,764 au lieu de 0,851.

`3-gemini.mjs --a-blanc` montre la requête exacte sans appeler. Relancer reprend les
prises manquantes.

**Google freine les appels partis d'un poste** (~10/min, puis 429 sur toutes les clés),
pas ceux partis de Cloudflare comme la prod (~190/min). Pour les prises, passer par le
relais `outils/relais` : le déployer le temps des mesures (`npx wrangler deploy`), poser
son mot de passe (`cache/relais.cle`, secret `RELAIS_CLE` par `wrangler secret put`),
lancer avec `GEMINI_RELAIS=https://relais-gemini-voix-38.<compte>.workers.dev`, puis le
SUPPRIMER (`npx wrangler delete`) et effacer `cache/relais.cle`.

Mesures du 2026-10-04 : 7 110 prises, 0 échec, 1,69 M jetons audio (~30 $ au tarif plein).

**Six langues ajoutées le 2026-10-22** (basque, arménien, luxembourgeois, ukrainien, ourdou, gallois —
les dernières langues de Piper que Gemini lit) : phrases, estimation, 540 prises par le relais en
`wrangler dev --remote` (1,7 min, 0 échec, ~0,90 $), 3 phrases du ratio. Les 54 langues d'avant gardent
EXACTEMENT leurs ratios : le lissage de la table entière les décalait de 1,2 % au plus ; les vitesses des
30 voix restent celles du 2026-10-11 et chaque nouvelle langue reçoit la sienne contre elles (médiane de
ratio mesuré ÷ vitesse de la voix). `voices.json` garde aussi les extraits des 25 langues qui ne sont
plus proposées (4-assembler ne réécrit que les langues proposées).

## Les 3 phrases du ratio des gammes à clé (2026-10-13)

`phrases_ratio.json` : pour chaque langue que spark-duree estime (60), **3 phrases de taille
moyenne** (83 à 85 caractères en anglais, ~5 s dites), traduites par le traducteur de la prod.
Le doublage ElevenLabs et Inworld mesure le débit de chaque voix sur ces 3 phrases, les mêmes pour
toutes les voix, et en garde la médiane (backend : `utils/verifier-voix-fournisseur.js`). Pas la
phrase de la table Gemini : 141 caractères en français, trop longue.

```bash
node scripts/7-phrases-ratio.mjs --a-blanc        # la requête exacte, aucun appel
node scripts/7-phrases-ratio.mjs                  # les traductions (162 appels, quelques centimes)
node scripts/7-phrases-ratio.mjs --vers-backend   # backend/.../shared/phrases-ratio/phrases.json
```

Changer une phrase change ses mesures : une prise ne vaut que pour SA phrase (le texte est
comparé), les voix seront remesurées sur celle-là seulement.
