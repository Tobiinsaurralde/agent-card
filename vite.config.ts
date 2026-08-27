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
