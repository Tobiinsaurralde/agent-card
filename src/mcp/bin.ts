#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SteelBrowser } from "../browser.js";
import { EnvCardProvider } from "../providers/env-card.js";
import { AgentCardService, type ServiceOptions } from "../service.js";
import { createMcpServer } from "./server.js";

/**
 * Entrypoint stdio. Se arranca desde el cliente MCP, no a mano.
 *
 * Regla que rompe todo si se olvida: en stdio, **stdout es el canal del
 * protocolo**. Cualquier `console.log` corrompe el stream y el cliente se cae
 * con un error de parseo que no menciona el log. Todo lo humano va a stderr.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    process.stderr.write(`[agent-card] ${name}="${raw}" no es un número válido; uso ${fallback}.\n`);
    return fallback;
  }
  return parsed;
}

async function main(): Promise<void> {
  const agentId = process.env.AGENT_CARD_AGENT_ID?.trim() ?? "";
  const budgetUsd = envNumber("AGENT_CARD_BUDGET_USD", 20);
  const maxCardUsd = envNumber("AGENT_CARD_MAX_CARD_USD", 20);

  const options: ServiceOptions = {
    maxCardBudgetCents: Math.round(maxCardUsd * 100),
  };

  // Sin STEEL_API_KEY el checkout corre en mock y el captcha se simula. Arrancar
  // igual es deliberado: la policy se prueba sin cuenta en Steel.
  const steelKey = process.env.STEEL_API_KEY?.trim();
  if (steelKey !== undefined && steelKey !== "") {
    options.browser = SteelBrowser.fromEnv();
  }

  // Con el gate prendido, el emisor es una tarjeta real y `get_card_credentials`
  // devuelve un número que cobra de verdad. Sin el gate, mock: la plata no se
  // mueve. Que la diferencia sea una sola variable es a propósito, y que falle
  // el arranque si la tarjeta está mal cargada también.
  const realCard = process.env.AGENT_CARD_ALLOW_MANUAL_PAN?.trim() === "1";
  let cardLabel: string | null = null;
  if (realCard) {
    const provider = EnvCardProvider.fromEnv();
    options.provider = provider;
    cardLabel = provider.label;
  }

  const service = new AgentCardService(options);
  service.deposit(Math.round(budgetUsd * 100));

  const server = createMcpServer({
    service,
    agentId: agentId === "" ? "default" : agentId,
  });

  process.stderr.write(
    [
      "[agent-card] servidor MCP arriba en stdio.",
      `[agent-card] agente="${agentId === "" ? "default" : agentId}" presupuesto=USD ${budgetUsd} techo-por-tarjeta=USD ${maxCardUsd}`,
      cardLabel === null
        ? `[agent-card] emisor="${service.providerName}" — NO hay cargos reales; la plata no se mueve.`
        : `[agent-card] emisor="${service.providerName}" tarjeta=${cardLabel} — CARGOS REALES: el número cobra de verdad.`,
      steelKey !== undefined && steelKey !== ""
        ? "[agent-card] checkout con Steel: el captcha se resuelve en la sesión."
        : "[agent-card] sin STEEL_API_KEY: checkout mock, captcha simulado.",
      "",
    ].join("\n"),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[agent-card] no pudo arrancar: ${message}\n`);
  process.exitCode = 1;
});
