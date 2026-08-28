import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Dónde va a vivir el sitio.
 *
 * En konex.xyz el sitio vive en la raíz (`SITE_BASE=/`). Si se sirve desde
 * `user.github.io/<repo>/` hay que poner `/<repo>/`: si no, CSS y JS dan 404
 * y la página carga en blanco.
 *
 * Las páginas viven en carpetas (`/docs/`, `/panel/`) para que la URL no
 * lleve `.html`. Los `.html` de la raíz quedan como redirect a esas rutas.
 */
const base = process.env["SITE_BASE"] ?? "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        panel: resolve(import.meta.dirname, "panel/index.html"),
        simulador: resolve(import.meta.dirname, "simulador/index.html"),
        docs: resolve(import.meta.dirname, "docs/index.html"),
        whitepaper: resolve(import.meta.dirname, "whitepaper/index.html"),
        tokenomics: resolve(import.meta.dirname, "tokenomics/index.html"),
        // Los viejos bookmarks con `.html` caen acá y saltan a la ruta limpia.
        "panel-html": resolve(import.meta.dirname, "panel.html"),
        "simulador-html": resolve(import.meta.dirname, "simulador.html"),
        "docs-html": resolve(import.meta.dirname, "docs.html"),
        "whitepaper-html": resolve(import.meta.dirname, "whitepaper.html"),
        "tokenomics-html": resolve(import.meta.dirname, "tokenomics.html"),
      },
    },
  },
});
