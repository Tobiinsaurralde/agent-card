import { fmt } from "../../src/policy.js";
import type { LogRow } from "../simulate.js";
import { Chip, cx } from "../ui.js";

/**
 * El historial como libro mayor: filas densas, montos en mono tabular alineados
 * a la derecha, lo más nuevo arriba. El motivo exacto es el producto.
 */
export function Ledger({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No attempts yet</p>
        <p className="text-xs text-muted-foreground">
          Try a USD 9.00 charge and then repeat it: the second one tells the story.
        </p>
      </div>
    );
  }

  const newestFirst = [...rows].reverse();

  return (
    <ol className="divide-y divide-border">
      {newestFirst.map((row, index) => (
        <li
          key={row.n}
          // Solo la fila recién agregada (arriba) anima su entrada.
          className={cx("py-3 first:pt-0 last:pb-0", index === 0 && "animate-row-in")}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num w-7 shrink-0 text-xs text-muted-foreground">
              #{String(row.n).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {row.merchant}
              </p>
              <p className="text-xs text-muted-foreground">
                {kindLabel(row.kind)} · {row.currency} · day {row.dayOffset}
              </p>
            </div>
            <span
              className={cx(
                "num text-sm font-semibold",
                row.approved ? "text-foreground" : "text-muted-foreground line-through",
              )}
            >
              {fmt(row.amountCents)}
            </span>
            <Chip tone={row.approved ? "success" : "destructive"}>
              {row.approved ? "APPROVED" : "DECLINED"}
            </Chip>
          </div>
          <p className="mt-1.5 pl-10 text-xs leading-relaxed text-muted-foreground">
            <span className={cx("num", !row.approved && "font-semibold text-destructive")}>
              {row.code}
            </span>{" "}
            · {row.reason}
          </p>
        </li>
      ))}
    </ol>
  );
}

function kindLabel(kind: LogRow["kind"]): string {
  switch (kind) {
    case "capture":
      return "Capture";
    case "auth":
      return "Authorization";
    case "incremental":
      return "Incremental";
    case "refund":
      return "Refund";
  }
}
