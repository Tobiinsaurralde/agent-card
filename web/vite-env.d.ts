/// <reference types="vite/client" />

/**
 * Variables de build que lee el front. Sólo las `VITE_*` llegan al browser, y
 * todo lo que llega al browser es público: acá no va nada secreto.
 */
interface ImportMetaEnv {
  /** Dónde postear la waitlist. Sin esto, el formulario no se dibuja. */
  readonly VITE_WAITLIST_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
