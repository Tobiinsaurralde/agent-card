# agent-card

Capa de control con **defaults seguros** para tarjetas de agentes de IA. Un agente compra online con
USDC de Solana y no puede gastar más allá de lo que la tarea pedía.

No es un emisor: no hay BIN, banco, PCI ni fondos de terceros. La emisión se compra a un proveedor
existente y esta capa va delante.

> Nombre de trabajo. La marca es una decisión aparte y renombrar cuesta un `mv` más un campo en
> `package.json`.

---

## Por qué existe

Los proveedores de tarjetas para agentes ya tienen las primitivas —límite por transacción, velocity,
MCC, budgets— y las venden como opciones. Ninguno te dice qué poner, y el 90% del riesgo está en la
config. Interlace, por ejemplo, acepta `transactionLimitsType: NA`: una tarjeta sin límite propio,
gastando contra el balance, es una opción legítima de su API.

Acá **no se puede** emitir una tarjeta sin cap acumulado ni sin TTL. Esa es la diferencia, y es una
opinión, no tecnología. Lo que no hacemos, a propósito:

- No competimos con el enforcement de la red. Visa Intelligent Commerce valida en la autorización que
  el cargo venga del merchant y por el monto de la *purchase intent* firmada; Mastercard Agent Pay ata
  límites y MCC a la credencial. Eso pasa en VisaNet y es más fuerte que cualquier cosa a nivel app.
- No emitimos, no custodiamos, y el PAN no toca nuestro backend.

Ver [`docs/spec.md`](docs/spec.md) para el mapa completo de la categoría y qué está ocupado.

---

## Estado

| Pieza | Estado |
|---|---|
| Motor de policy + defaults seguros | listo, con tests |
| Recibos con atribución por tarea | listo |
| Harness de escenarios (mock) | listo |
| Browser de checkout + captcha (Steel) | listo — prende `solveCaptcha` en la sesión |
| Panel del usuario | listo — sobre el motor real, emisor mock |
| Servidor MCP | listo — 11 tools, contra emisor mock |
| Automatización del checkout | listo — probada contra Chrome real, sin emisor |
| Medición con una tarjeta real | **pendiente, y es lo único que importa ahora** |
| Adaptador de emisor real | pendiente — depende del resultado de la medición |

Lo que sigue faltando es lo único que puede matar el producto: medir contra un emisor real si los
bypasses existen de verdad. El servidor MCP corre hoy contra `MockProvider`, así que prueba la
política, no el rail. Ver `docs/spec.md` §4.

---

## Uso

```bash
npm install
npm test        # tests de la policy
npm run harness # escenarios naive vs hardened
npm run dev     # landing (/), panel (/panel.html), simulador (/simulador.html)
```

El panel es la vista del humano: saldo, tarjetas por agente, recibos con el motivo exacto y kill
switch global. Corre contra el motor real —cada aprobación y cada rechazo salen de `evaluate()`— con
`MockProvider` como rail y `MockBrowser` como checkout. Cuando exista el adaptador de Interlace se
reemplazan esas dos piezas y el panel no cambia.

El harness corre contra `MockProvider`, que modela un emisor que aprueba todo mientras haya fondos.
**Mide la policy, no el rail.** Los números que valen son los del proveedor real con cargos reales.

El captcha del checkout lo resuelve Steel en la misma sesión del navegador. Copiá `.env.example` a
`.env` y poné `STEEL_API_KEY`. Sin la key, `MockBrowser` simula la resolución para tests.

---

## Medir si la tarjeta compra online

Es el test del que depende todo lo demás. Se corre dos veces —con una tarjeta virtual tuya y
con la del emisor candidato— y la comparación es el resultado.

```bash
npm run test:checkout -- --url https://comercio.com/checkout
```

Un intento por corrida, nunca reintenta, y cuando el resultado es ambiguo dice `DESCONOCIDO`
en vez de `RECHAZADO`: un falso rechazo invita a reintentar, y reintentar un cobro que sí entró
es cobrarle dos veces al usuario. El protocolo completo está en
[`docs/medir-compra-online.md`](docs/medir-compra-online.md).

---

## El servidor MCP

Es la puerta por la que un agente usa las tarjetas. Se arranca desde el cliente, no a mano:

```json
{
  "mcpServers": {
    "agent-card": {
      "command": "npm",
      "args": ["--prefix", "/ruta/a/agent-card", "run", "mcp"],
      "env": {
        "AGENT_CARD_AGENT_ID": "research-bot",
        "AGENT_CARD_BUDGET_USD": "20",
        "AGENT_CARD_MAX_CARD_USD": "20"
      }
    }
  }
}
```

| Tool | Qué hace |
|---|---|
| `get_budget` | disponible, gastado, comprometido |
| `request_card` | emite con topes obligatorios. Devuelve handle, nunca el PAN |
| `get_card_credentials` | endpoint + token de vida corta para canjear el PAN con el emisor |
| `check_charge` | preflight: dice si pasaría, sin gastar ni dejar rastro |
| `record_charge` | el cargo real: la policy decide y queda el recibo |
| `open_checkout` | sesión de navegador con captcha y proxy ya prendidos |
| `card_status` / `list_cards` | estado, gastado, restante, motivo del último rechazo |
| `list_charges` | recibos con la tarea que causó cada cargo |
| `close_card` / `complete_task` | cierre puntual, o cierre de todas las tarjetas de la tarea |

Lo que el servidor **no** expone es tan importante como lo que expone:

- **No hay `deposit`.** Un agente que se fondea solo no tiene presupuesto. Eso lo hace el humano.
- **No hay `kill_all` ni `release_kill`.** El kill switch es del humano: si el agente pudiera
  apagarlo sería decorativo, y si pudiera dispararlo tendría un DoS sobre las tarjetas ajenas.
- **No hay parámetro de identidad.** El `agentId` sale de la config del servidor. Si el agente
  pudiera declarar quién es, gastaría del presupuesto de otro.
- **No hay nada que afloje un tope ya emitido**, ni una tool que resuelva captchas por separado: se
  resuelven en la sesión del navegador o el token no vale.

### El límite honesto

Este servidor **no está en el camino de la autorización**. Con un emisor real, la red le pregunta al
emisor, no a nosotros. Lo que hace cumplir el techo son los caps que se configuran en la tarjeta al
emitirla; `check_charge` es un preflight y `record_charge` es el recibo. Un agente que compra y nunca
llama a `record_charge` deja el presupuesto desalineado, y la única defensa real en ese caso es el cap
que ya está puesto en la tarjeta.

---

## Los defaults

```ts
import { safePolicy } from "./src/defaults.js";

const policy = safePolicy({
  budgetCents: 1000,        // obligatorio: cap acumulado
  merchant: "api-credits",  // obligatorio: allowlist, no blacklist
  ttlSeconds: 24 * 60 * 60, // por defecto 24 h
});
```

`safePolicy` tira error si falta el presupuesto o el merchant. `permissivePolicy` es lo que escribe
todo el mundo primero —solo cap por transacción— y existe únicamente como grupo de control del
benchmark.

Qué bloquea cada default:

| Default | Bypass que cierra |
|---|---|
| `lifetimeCents` obligatorio | structuring: N cargos por debajo del cap por transacción |
| `ttlSeconds` obligatorio | tarjeta que vive para siempre |
| `closeOnTaskComplete` | suscripción zombie que renueva después de la tarea |
| `merchantAllowlist` | cobro en un merchant que no era el de la tarea |
| `allowedCurrencies` | cargo en otra moneda que esquiva el cap en USD |
| `grossSpendAccounting` | comprar → devolver → volver a comprar |
| `singleUse` | PAN filtrado al contexto del agente |

---

## Arquitectura

```
src/types.ts     tipos del dominio; montos en centavos, nunca floats
src/policy.ts    evaluate(): DENY gana, se evalúa server-side
src/defaults.ts  safePolicy (el producto) / permissivePolicy (el control)
src/provider.ts  interfaz CardProvider + MockProvider en memoria
src/card.ts      ControlledCard: policy delante del rail, más recibos
src/browser.ts   checkout en Steel: captcha prendido, eventos en el recibo
src/service.ts   el servicio: wallet, tarjetas, recibos, kill switch
src/checkout.ts  leer de la página si el cobro pasó, y si no, por qué
src/driver.ts    manejar el checkout: llenar la tarjeta, enviar, leer el veredicto
src/credentials.ts  la tarjeta real del test, que se redacta sola al loguearse
src/mcp/server.ts  las tools que ve el agente
src/mcp/bin.ts     entrypoint stdio
harness/         escenarios y runner
web/panel/       panel del usuario: store sobre el motor + UI
web/landing/     landing del producto
web/App.tsx      simulador de política
docs/spec.md     spec, mapa de competidores y plan de medición
docs/omnihood-analysis.md
```

Dos reglas de arquitectura que no se negocian:

1. **El PAN no pasa por el backend propio.** No hay `getPan()` en `CardProvider`. Lo pide el cliente
   MCP directo al proveedor con un token de vida corta. Si atraviesa nuestro servidor, entramos en
   scope PCI.
2. **Nunca custodiar fondos de usuarios.** Delegate on-chain, o el balance del proveedor. Un balance
   propio agregado es transmisión de dinero.

### Deuda conocida

`web/panel/store.ts` duplica la lógica de tesorería y emisión que ahora vive en `src/service.ts`. El
panel se escribió antes que el servicio y todavía no lo usa. Son dos implementaciones de la misma
regla, que es exactamente la forma en que dos números empiezan a no coincidir. Falta hacer que el
store sea un adaptador delgado sobre `AgentCardService`.
