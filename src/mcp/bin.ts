#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SteelBrowser } from "../browser.js";
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
      `[agent-card] emisor="${service.providerName}" — NO hay cargos reales; la plata no se mueve.`,
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
