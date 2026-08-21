import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fmt } from "../src/policy.js";
import { scenarios, type PolicyKind, type ScenarioResult } from "./scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));
const kinds: PolicyKind[] = ["naive", "hardened"];

async function main(): Promise<void> {
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.log(`\n${"─".repeat(72)}`);
    console.log(scenario.name);
    console.log(`Hipótesis: ${scenario.hypothesis}`);
    console.log(`Techo pretendido: ${fmt(scenario.intendedCapCents)}`);

    for (const kind of kinds) {
      const result = await scenario.run(kind);
      results.push(result);

      console.log(`\n  [${kind}]`);
      for (const a of result.attempts) {
        const mark = a.approved ? "APROBADO" : "RECHAZADO";
        console.log(
          `    ${a.step}. ${fmt(a.amountCents)} en ${a.merchant} → ${mark} (${a.policyCode})`,
        );
        if (!a.approved) console.log(`       ${a.reason}`);
      }
      console.log(
        `    total aprobado: ${fmt(result.approvedTotalCents)} sobre un techo de ${fmt(result.intendedCapCents)}`,
      );
      console.log(
        `    bypass: ${result.bypassSucceeded ? "FUNCIONÓ" : "bloqueado"}`,
      );
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log("Resumen\n");
  console.log("| escenario | naive | hardened |");
  console.log("|---|---|---|");
  for (const scenario of scenarios) {
    const cell = (kind: PolicyKind): string => {
      const r = results.find(
        (x) => x.scenarioId === scenario.id && x.policyKind === kind,
      );
      if (r === undefined) return "—";
      return r.bypassSucceeded
        ? `bypass (${fmt(r.approvedTotalCents)})`
        : `bloqueado (${fmt(r.approvedTotalCents)})`;
    };
    console.log(`| ${scenario.name} | ${cell("naive")} | ${cell("hardened")} |`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(here, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `mock-${stamp}.jsonl`);
  writeFileSync(
    outFile,
    results.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );

  console.log(`\nLog: ${outFile}`);
  console.log(
    "\nEsto corre contra MockProvider: mide la policy, no el rail. Los números\n" +
      "que valen son los del proveedor real con cargos reales. Ver docs/spec.md §4.",
  );

  const naiveBypasses = results.filter(
    (r) => r.policyKind === "naive" && r.bypassSucceeded,
  ).length;
  const hardenedBypasses = results.filter(
    (r) => r.policyKind === "hardened" && r.bypassSucceeded,
  ).length;
  if (hardenedBypasses > 0) {
    console.error(
      `\nFALLA: ${hardenedBypasses} bypass(es) pasaron con la config hardened.`,
    );
    process.exitCode = 1;
  } else if (naiveBypasses === 0) {
    console.error(
      "\nFALLA: ningún bypass pasó con la config naive. El escenario no prueba nada.",
    );
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
