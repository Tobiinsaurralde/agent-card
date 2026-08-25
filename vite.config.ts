import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Dónde va a vivir el sitio.
 *
 * GitHub Pages sirve un repo de proyecto desde `/<repo>/`, no desde la raíz, y
 * con el base mal puesto las hojas de estilo y los bundles dan 404: la página
 * carga en blanco sin ningún error visible. Con dominio propio esto vuelve a
 * "/", y por eso es una variable y no una constante.
 *
 * Los links entre páginas son relativos a propósito, así funcionan con
 * cualquiera de los dos.
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
        panel: resolve(import.meta.dirname, "panel.html"),
        simulador: resolve(import.meta.dirname, "simulador.html"),
      },
    },
  },
});
