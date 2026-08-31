import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cx, focusRing } from "../ui.js";

/**
 * El esqueleto compartido de las páginas editoriales (docs, whitepaper, $KNX).
 *
 * La landing tiene su propia navbar inline porque sus links son anclas de la
 * misma página; acá los links son siempre los mismos y triplicarlos a mano es
 * la clase de cosa que después queda desincronizada.
 */

const LINKS = [
  { href: "/docs/", label: "DOCS" },
  { href: "/whitepaper/", label: "WHITEPAPER" },
  { href: "/tokenomics/", label: "$KNX" },
  { href: "/panel/", label: "DASHBOARD" },
] as const;

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-foreground/15 bg-background/90 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 md:px-6">
        <a href="/" className={cx("flex items-center gap-2.5 rounded-md", focusRing)}>
          <img src="/logo-light.png" alt="" className="size-8" />
          <span className="font-display text-lg leading-none">Konex</span>
        </a>
        <div className="hidden items-center gap-5 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.href === current ? "page" : undefined}
              className={cx(
                "rounded-sm font-mono text-[11px] font-semibold tracking-[0.18em] transition-colors duration-100 ease-out hover:text-accent",
                link.href === current ? "text-accent" : "text-muted-foreground",
                focusRing,
              )}
            >
              {link.label}
            </a>
          ))}
        </div>
        <a
          href="/simulador/"
          className={cx(
            "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold",
            "shadow-soft bg-primary text-primary-foreground hover:bg-primary/85",
            "transition-[background-color,transform,box-shadow] duration-100 ease-out active:translate-x-px active:translate-y-px active:shadow-none",
            focusRing,
          )}
        >
          Try the simulator
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-foreground/15">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-3">
          <img src="/logo-light.png" alt="" className="size-9" />
          <span className="font-display text-lg">Konex</span>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          A control layer, not an issuer. The BIN, the bank and the KYC are
          bought from a provider; we decide whether the charge goes through.
        </p>
        <div className="flex flex-wrap gap-4">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cx(
                "rounded-sm font-mono text-[11px] font-semibold tracking-[0.18em] text-accent underline-offset-4 hover:underline",
                focusRing,
              )}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

/** Cabecera de página editorial: tag mono, título grande, bajada. */
export function PageIntro({
  tag,
  title,
  lead,
}: {
  tag: string;
  title: ReactNode;
  lead: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-14 md:px-6 md:pt-20">
      <span className="inline-block rounded-md border border-gold/45 bg-gold-soft px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.2em] text-gold">
        {tag}
      </span>
      <h1 className="font-display mt-5 text-4xl leading-[1.04] md:text-6xl">{title}</h1>
      <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground md:text-lg">
        {lead}
      </div>
    </div>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-foreground/10 py-10 md:py-14">
      <h2 className="font-display text-3xl leading-[1.06] md:text-4xl">
        <a href={`#${id}`} className={cx("rounded-sm", focusRing)}>
          {title}
        </a>
      </h2>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-foreground/85">
        {children}
      </div>
    </section>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="font-display pt-3 text-xl md:text-2xl">{children}</h3>;
}

/** Bloque de código sin resaltado: mono, oscuro, scrolleable. */
export function Code({ children }: { children: string }) {
  return (
    <pre className="shadow-soft overflow-x-auto rounded-xl border border-foreground/20 bg-[oklch(0.19_0.022_265)] px-4 py-3.5 text-xs leading-relaxed text-white/85">
      <code className="num">{children}</code>
    </pre>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="num rounded-md border border-border bg-card px-1.5 py-0.5 text-[0.85em]">
      {children}
    </code>
  );
}

type CalloutTone = "warning" | "info" | "danger";

const calloutTones: Record<CalloutTone, string> = {
  warning: "border-warning/40 bg-warning-soft",
  info: "border-accent/35 bg-accent-soft",
  danger: "border-destructive/40 bg-destructive-soft",
};

export function Callout({
  tone,
  title,
  children,
}: {
  tone: CalloutTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className={cx("shadow-soft rounded-xl border p-4 md:p-5", calloutTones[tone])}>
      <p className="font-mono text-[11px] font-semibold tracking-[0.18em]">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-foreground/85">{children}</div>
    </aside>
  );
}

/** Tabla editorial: header mono, filas divididas, scroll horizontal en mobile. */
export function Table({
  head,
  rows,
}: {
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="shadow-soft overflow-x-auto rounded-xl border border-foreground/20 bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-4 py-3 font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className="px-4 py-3 align-top leading-relaxed">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Índice lateral fijo en desktop, oculto en mobile. */
export function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <nav aria-label="On this page" className="sticky top-24 hidden self-start lg:block">
      <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
        ON THIS PAGE
      </p>
      <ul className="mt-3 space-y-2 border-l border-border pl-4">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cx(
                "rounded-sm text-[13px] text-muted-foreground transition-colors duration-100 hover:text-accent",
                focusRing,
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Layout de dos columnas: contenido + índice. */
export function ProseLayout({
  toc,
  children,
}: {
  toc: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 md:px-6 md:pb-24 lg:grid-cols-[1fr_220px]">
      <div className="max-w-3xl">{children}</div>
      <Toc items={toc} />
    </div>
  );
}
