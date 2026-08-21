# idea-context

```json
{
  "phase": "build",
  "completed_at": "2026-08-21T14:40:00Z",
  "chosen_idea": {
    "slug": "agent-card-control-plane",
    "name": "Agent Card Control Plane",
    "one_liner": "Capa de policy + recibos delante de un issuer existente: el agente compra con USDC de Solana y no puede gastar lo que no le corresponde.",
    "why_crypto": "Funding nativo en USDC Solana y allowance delegada on-chain: el límite es verificable y revocable sin confiar en el dashboard del proveedor.",
    "status": "build"
  },
  "scope_decision": {
    "build": "Policy engine + MCP tools + recibos + harness de escenarios de bypass.",
    "buy": "Emisión (BIN, banco, red Visa/MC, PCI, KYC) via proveedor existente.",
    "never": "Custodiar fondos de usuarios en balance propio. PAN atravesando backend propio."
  },
  "market_facts": [
    "Funding USDC-on-Solana ya es nativo: Karma Card (wallet Solana por tarjeta, Helius), MoonPay MoonAgents (delegate USDC/XO Solana, emite Monavate), Bridge/Privy (programa delegate cardWArqhdV5jeRXXjUti7cHAa4mj41Nj3Apc6RPZH2), Cryptocardium, Laso (x402).",
    "amrixsol/karma-agent es casi exactamente este producto y es open source. Leerlo antes de codear.",
    "MCP de emisión ya existe (Cryptocardium 40+ tools, Slash). Un wrapper de emisión no diferencia.",
    "Issuance sin entidad propia es viable: Cryptocardium/CrypTopCard (no-KYC), SPND/KemyCard (BIN sponsorship).",
    "No hace falta bridge: el bridge multichain de OmniHood no aporta nada técnico aca."
  ],
  "differentiator": "Defaults seguros + DX + español + LATAM sobre un emisor existente. NO es un policy engine: Visa Intelligent Commerce hace intent binding enforced en VisaNet (purchase intent + instruction ID, valida merchant y monto en la autorización) y Mastercard Agent Pay ata límites y MCC a la credencial. Interlace ya shippeó el MCP con Velocity Control (DAY..LIFETIME), per-tx, MCC whitelist/blacklist y budget cards. Decisión explícita del usuario: construir el wrapper igual, compitiendo por UX y nicho LATAM, aceptando que no hay moat técnico.",
  "moat_honesto": "Distribución (audiencia propia), opinión (defaults), DX, español. Riesgo: si un proveedor shippea buenos defaults en español, el producto pierde razón.",
  "blocking_decisions": [
    "Proveedor: emitir tarjeta + cargo online recurrente real desde Argentina. Si falla, no hay producto.",
    "Descartar programas no-KYC: sin AVS ni 3DS los checkouts online rechazan, y el agente solo compra online. KYC del titular es requisito de producto.",
    "PAN nunca pasa por backend propio (token scoped desde el cliente MCP al proveedor). Evita scope PCI.",
    "Custodia: delegate on-chain > wallet-por-tarjeta del proveedor > balance propio comingled (nunca)."
  ],
  "omnihood_verdict": {
    "status": "no va en camino critico",
    "detail": "Ver omnihood-analysis.md. Agregador de Relay + Jupiter + LayerZero + un issuer sin nombrar, construido en 3 dias. La tarjeta no-KYC no funciona online por admision publica del fundador (demos: cafe y GoFundMe); el caso de uso de agentes es 100% card-not-present. Token OMHD en Robinhood Chain (no Solana): mcap USD 14-27k, 229 holders, 17-67 txns/24h, un solo par pese a vender 'launch on every chain'. Docs admiten pool comingled en una cuenta del issuer y retiros de una sola via. Utilidad del token cambio 3 veces en semanas.",
    "founder": "Sebastian Ramirez @0xSebasDev, Colombia. Ex-founder de Decentra, embajador Celo Colombia, presencia LATAM verificable. Builder real y rapido. La relacion vale; el stack y el token no.",
    "usable_intel": [
      "Prueba que un dev solo en LATAM sin entidad puede revender un programa de tarjetas y estar live en dias: confirma buy-don't-build.",
      "Define el proveedor que NO sirve: no-KYC = sin online. Ahorra la decision mas costosa del proyecto.",
      "Regala el diferenciador: pool comingled + retiros de una via se responde con delegate on-chain ('tu plata nunca es mia').",
      "Copiar de ellos: el PAN nunca pasa por su servidor, se busca directo del issuer al browser."
    ],
    "price_of_entry_si_alguna_vez_integran": ["nombre del emisor/BIN", "un cargo online verificable, no Apple Pay en local", "acceso a API"]
  },
  "risks": [
    { "category": "market", "description": "Karma Card / MoonPay / Bridge ya shippearon la emisión con Solana. Llegar como issuer es tarde.", "severity": "high" },
    { "category": "thesis", "description": "Si los bypasses 1 y 2 no pasan en proveedores reales, la tesis del producto se cae.", "severity": "high" },
    { "category": "regulatory", "description": "Custodiar USDC de usuarios = transmisión de dinero. Evitar por diseño.", "severity": "high" },
    { "category": "dependency", "description": "OmniHood: sin cargo live verificable, BIN y API, no va en camino crítico. Solo distribución.", "severity": "medium" }
  ],
  "revenue": "Fee por agente/mes por la capa de control, o spread sobre funding. El interchange es del emisor.",
  "v1_scope": {
    "in": ["MCP: get_budget, request_card, card_status, close_card, list_charges", "Policy engine server-side (cap por tarea, cap acumulado, TTL con cierre, allowlist merchant, kill switch)", "Recibos cargo -> tarea, export CSV", "Un proveedor, USDC Solana, USD", "Harness de 7 escenarios naive vs hardened"],
    "out": ["Multichain", "Tarjetas físicas", "Equipos/orgs", "Cashback", "Dashboard", "Token"]
  },
  "provider_pick": "Interlace Agent Card. Solo online (POS/ATM rechazados), MCP nativo, funding USDC/USDT on-chain, Velocity Control API, MCC whitelist/blacklist, budget cards, PAN solo al agente por MCP. Cap de USD 20 por tarjeta acota el riesgo al presupuesto del test. Segundo: Karma Card (Solana nativo, open source, marca el piso del wrapper).",
  "test_plan": {
    "presupuesto": "USD 20-50",
    "escenario_1_structuring": "Cap per-tx USD 10 sin cap acumulado, dos cargos de USD 9 en top-up de créditos de API. Bypass = entran los dos (USD 18 con cap de 10). Hardened = LIFETIME USD 10 además del per-tx.",
    "escenario_2_suscripcion_zombie": "Tiene dependencia de calendario: la renovación real llega en 30 días. Proxy rápido hoy: suscribirse, marcar tarea completada, intentar segundo cargo en el mismo merchant. Arrancar la versión de 30 días en paralelo.",
    "registro": "config exacta, monto, merchant, timestamp, resultado, código de rechazo. Sin eso es anécdota, no medición.",
    "criterio_de_muerte": "Si ningún bypass entra con la config permisiva del proveedor, el wrapper no tiene razón de existir y hay que decidir de nuevo."
  },
  "next_steps": [
    "Alta en Interlace, API key, emitir una tarjeta. Verificar que se puede desde Argentina.",
    "Un cargo online real de USD 5 en un SaaS. Si falla, nada más importa.",
    "Escenario 1 con USD 18, registrando todo.",
    "Arrancar escenario 2 (30 días) + proxy rápido.",
    "Con los datos en la mano, recién ahí codear el wrapper.",
    "Leer amrixsol/karma-agent: marca el piso de lo que el wrapper tiene que agregar."
  ],
  "source_reports": [
    "idea-shortlist-20260821-103500.html",
    "idea-validation-agent-card-20260821.html",
    "agent-card-spec.md"
  ]
}
```
