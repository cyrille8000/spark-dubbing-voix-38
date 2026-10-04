// Relaie POST /v1beta/... vers generativelanguage.googleapis.com. Refuse tout
// appel sans le bon en-tête x-relais-cle (secret RELAIS_CLE). La clé Gemini
// arrive dans x-goog-api-key et repart telle quelle, jamais journalisée.
export default {
  async fetch(req, env) {
    const attendu = env.RELAIS_CLE || '';
    if (!attendu || req.headers.get('x-relais-cle') !== attendu) return new Response('interdit', { status: 403 });
    const url = new URL(req.url);
    return fetch(`https://generativelanguage.googleapis.com${url.pathname}${url.search}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.headers.get('x-goog-api-key') || '' },
      body: await req.arrayBuffer(),
    });
  },
};
