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
| Adaptador Interlace real | pendiente — necesita API key |
| Servidor MCP | pendiente — a propósito, después de la medición real |
| Medición con cargos reales | pendiente — es el próximo paso |

El servidor MCP no está escrito todavía y eso es deliberado: primero hay que medir si los bypasses
existen de verdad contra un proveedor real. Si no existen, el producto no tiene razón de ser y no
tiene sentido haber construido la fachada. Ver `docs/spec.md` §4.

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
