// Crochet de chargement Node : un `import x from "./f.wasm"` rend un
// WebAssembly.Module compilé — exactement ce que la règle `CompiledWasm` de
// wrangler donne au worker spark-vad. Permet d'importer `spark-vad/src/vad.js`
// TEL QUEL, sans le recopier.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.wasm')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `import fs from 'node:fs';\nexport default new WebAssembly.Module(fs.readFileSync(new URL(${JSON.stringify(url)})));\n`,
    };
  }
  return nextLoad(url, context);
}
