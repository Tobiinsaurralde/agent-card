import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Levanta el binario de verdad como subproceso y le habla JSON-RPC por stdio.
 *
 * Los tests en memoria no atrapan el error más fácil de cometer acá: un
 * `console.log` de diagnóstico en stdout, que es el canal del protocolo y deja
 * el servidor inusable aunque toda la lógica esté bien. Este test se cae si
 * alguien imprime una sola línea en el canal equivocado.
 */
test("el binario hace handshake por stdio con stdout limpio", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "src/mcp/bin.ts"],
    env: {
      ...process.env,
      AGENT_CARD_AGENT_ID: "stdio-test",
      AGENT_CARD_BUDGET_USD: "50",
    },
    stderr: "pipe",
  });

  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, "el servidor no publicó ninguna tool");
    assert.ok(tools.some((t) => t.name === "request_card"));

    // Un ciclo completo contra el proceso real, no contra un doble.
    const issued = await client.callTool({
      name: "request_card",
      arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-stdio" },
    });
    assert.notEqual(issued.isError, true, textOf(issued));
    const handle = /crd_[0-9a-f]+/.exec(textOf(issued))?.[0];
    assert.ok(handle !== undefined, `sin handle en:\n${textOf(issued)}`);

    const first = await client.callTool({
      name: "record_charge",
      arguments: { handle, amount_usd: 9 },
    });
    assert.match(textOf(first), /Aprobado/);

    // El structuring tiene que morir también acá, no solo en memoria.
    const second = await client.callTool({
      name: "record_charge",
      arguments: { handle, amount_usd: 9 },
    });
    assert.match(textOf(second), /LIFETIME_EXCEEDED/);
  } finally {
    await client.close();
  }
});

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return (content ?? []).map((c) => c.text ?? "").join("\n");
}
