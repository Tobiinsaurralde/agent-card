import { Wifi } from "lucide-react";
import { cx } from "../ui.js";

export type CardVisualStatus = "activa" | "cerrada" | "kill";

/**
 * La tarjeta como objeto. Es una tarjeta física simulada: el gradiente es fijo
 * (una tarjeta no cambia de color con el tema) y es el único gradiente del producto.
 */
export function VirtualCard({
  issued,
  last4,
  status,
  ttlLabel,
  presetLabel,
  holder = "AGENT · TASK-DEMO",
  compact = false,
  className,
}: {
  issued: boolean;
  last4: string;
  status: CardVisualStatus;
  ttlLabel: string;
  presetLabel: string;
  /** Agente y tarea reales. El default es solo para la demo de la landing. */
  holder?: string;
  /** Para listas: el PAN completo no entra en ~200px y se corta. */
  compact?: boolean;
  className?: string | undefined;
}) {
  if (!issued) {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[1.586] w-full items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/40"
      >
        <p className="text-xs font-medium tracking-wide text-muted-foreground">
          NOT ISSUED
        </p>
      </div>
    );
  }

  const dead = status !== "activa";

  return (
    <div
      className={cx(
        "card-shine relative aspect-[1.586] w-full overflow-hidden rounded-2xl p-4 text-white shadow-lg sm:p-5",
        className,
      )}
      style={{
        background:
          "radial-gradient(120% 90% at 15% 0%, oklch(0.32 0.05 262) 0%, transparent 55%), radial-gradient(55% 45% at 90% 95%, oklch(0.75 0.11 92 / 7%) 0%, transparent 70%), linear-gradient(135deg, oklch(0.23 0.03 265) 0%, oklch(0.15 0.02 250) 100%)",
      }}
    >
      <div
        className={cx(
          "flex h-full flex-col justify-between transition-opacity duration-200 ease-out",
          dead && "opacity-35",
        )}
      >
        <div className="flex items-start justify-between gap-1.5">
          <span className="font-display truncate text-sm leading-none tracking-tight">
            Konex
          </span>
          <span className="shrink-0 whitespace-nowrap rounded-full border border-white/25 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-white/80">
            {presetLabel}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Chip EMV estilizado. */}
          <div
            aria-hidden="true"
            className="grid h-7 w-9 grid-cols-2 gap-px overflow-hidden rounded-md bg-gradient-to-br from-amber-200 to-amber-400 p-1"
          >
            <span className="rounded-sm bg-amber-500/40" />
            <span className="rounded-sm bg-amber-500/40" />
            <span className="rounded-sm bg-amber-500/40" />
            <span className="rounded-sm bg-amber-500/40" />
          </div>
          <Wifi aria-hidden="true" className="size-4 rotate-90 text-white/60" />
        </div>

        <p
          className={cx(
            "font-mono",
            compact
              ? "text-sm tracking-[0.12em]"
              : "text-base tracking-[0.18em] sm:text-lg",
          )}
          aria-label={`Card ending in ${last4}`}
        >
          {compact ? (
            <>••••&nbsp;&nbsp;{last4}</>
          ) : (
            <>••••&nbsp;&nbsp;••••&nbsp;&nbsp;••••&nbsp;&nbsp;{last4}</>
          )}
        </p>

        <div className="flex items-end justify-between gap-2 text-[10px] tracking-wider text-white/70">
          <div className="min-w-0">
            <p className="mb-0.5 text-[9px] text-white/45">HOLDER</p>
            <p className="truncate font-mono font-medium text-white/90">{holder}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mb-0.5 text-[9px] text-white/45">TTL</p>
            <p className="font-mono font-medium text-white/90">{ttlLabel}</p>
          </div>
        </div>
      </div>

      {dead && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cx(
              "animate-stamp-in whitespace-nowrap rounded-md border-2 font-mono font-bold",
              compact
                ? "px-2.5 py-1 text-xs tracking-[0.2em]"
                : "px-4 py-1.5 text-lg tracking-[0.3em]",
              status === "kill"
                ? "border-destructive text-destructive"
                : "border-white/70 text-white/90",
            )}
          >
            {status === "kill" ? "KILL" : "CLOSED"}
          </span>
        </div>
      )}
    </div>
  );
}
