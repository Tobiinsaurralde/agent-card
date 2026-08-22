# Agent Card — spec v1

**Decisión tomada (21 ago 2026):** construir la capa de control sobre un emisor existente, **aceptando
que es un wrapper**, y competir por UX, defaults y nicho LATAM. No por tecnología.

**Qué es:** un MCP con defaults seguros para que un agente compre online con USDC de Solana, en
español, pensado para un dev solo y no para un finance team de EE.UU.

**Qué NO es:** un emisor (nada de BIN, banco, PCI ni fondos de terceros), ni un policy engine que
compita con la red.

---

## 1. Contra qué competimos, sin autoengaño

| Capa | Quién la ocupa | Nuestra posición |
|---|---|---|
| Enforcement en la autorización | **Visa Intelligent Commerce** (purchase intent + instruction ID, VisaNet valida merchant y monto), **Mastercard Agent Pay** (Agentic Tokens + Verifiable Intent) | Inalcanzable. No competimos acá. |
| Credencial + identidad del agente | Alchemy AgentCard (sobre VIC), Stripe, Crossmint | No competimos. |
| Emisión + funding cripto + MCP | **Interlace**, Karma, Laso, Cryptocardium | **Lo compramos.** |
| Defaults, DX, idioma, precio | — | **Acá jugamos.** |

Ninguna de esas empresas va a hacer estas cuatro cosas, y no por incapacidad sino por incentivo:

1. **Defaults permisivos.** Un proveedor optimiza para que nada se rompa: `transactionLimitsType: NA`
   (sin límite de tarjeta) es una opción real en Interlace. Nosotros optimizamos para que nada se
   escape. Vendemos la opinión, no la primitiva.
2. **Venden primitivas, no configuración.** Te dan velocity, MCC y per-tx; no te dicen qué poner.
   El 90% del riesgo está en la config, y la config es donde se pierde la gente.
3. **Inglés y EE.UU. primero.** Ninguno tiene onboarding en español ni piensa en un dev argentino.
4. **Cada uno vende su propio rail.** Ninguno va a rutear a un competidor cuando su BIN rechaza.

**Aceptemos lo que esto implica:** no hay moat técnico. El moat posible es distribución (tu audiencia),
opinión (los defaults), DX y LATAM. Si en 6 meses un proveedor shippea defaults buenos en español, el
producto pierde su razón. Vale saberlo ahora.

---

## 2. Proveedor: Interlace primero

Requisito no negociable: **card-not-present online**. Un agente solo compra online. Los programas
no-KYC quedan afuera — ver `omnihood-analysis.md`: sin AVS ni 3-D Secure los checkouts y las
suscripciones rechazan, y su propio fundador lo admite.

**Interlace Agent Card** es el primer candidato:

- **Solo online.** POS y ATM se rechazan automáticamente. Es exactamente el caso de uso, al revés de
  OmniHood.
- **MCP nativo:** `issue_card`, `get_card`, `get_transactions`, `delete_card`,
  `list_wallet_balances`, `get_withdraw_link`.
- **Funding on-chain** en USDC/USDT.
- **Controles reales:** Velocity Control API con ventanas DAY/WEEK/MONTH/QUARTER/YEAR/LIFETIME,
  límite por transacción, whitelist/blacklist de MCC, y *budget cards* con pool compartido y velocity
  por tarjeta.
- **El PAN se entrega solo al agente por MCP**, nunca en texto plano en la web. Coincide con §3.2.
- **Límite de USD 20 por tarjeta y una tarjeta activa por usuario.** Restricción de beta, no de
  arquitectura — y para este test es una ventaja: acota el riesgo financiero exactamente al presupuesto.

Segundo candidato: **Karma Card** (`amrixsol/karma-agent`), Solana nativo, wallet por tarjeta, KYC del
owner una vez, límites per-tx / diario / mensual. Leer el repo igual: es open source y hace el 80% de
esto, así que marca el piso de lo que un wrapper tiene que agregar para justificarse.

---

## 3. Decisiones de arquitectura (no negociables)

### 3.1 El PAN no pasa por el backend propio
Lo pide el cliente MCP directo al proveedor, con token scoped y de vida corta. Si atraviesa nuestro
servidor entramos en scope PCI y en responsabilidad por filtración. Interlace ya funciona así.

### 3.2 Nunca custodiar fondos de usuarios
En orden de preferencia: delegate on-chain (el allowance vive en la wallet del usuario, verificable y
revocable) → wallet/balance del proveedor → **nunca** un balance propio agregado. OmniHood hace lo
último (*"all card deposits pool into one issuer account"*) más retiros de una sola vía. Eso es el
antiejemplo, y es la base del posicionamiento: **tu plata nunca es mía**.

### 3.3 `DENY` gana, y la policy vive fuera del prompt
La decisión se evalúa server-side. Un agente no puede negociar su propio límite.

### 3.4 El captcha se resuelve en el browser, no en el MCP
Si aparece un captcha en el checkout, Steel lo detecta y lo resuelve en la misma
sesión del navegador (`solveCaptcha: true` + proxy residencial). Nuestro código
solo espera el resultado y lo anota en el recibo. CapSolver/2Captcha no se
integran directo: el token tiene que nacer en la misma sesión que navega.

Ver `docs/captcha-y-3ds.md`.

---

## 4. El test: USD 20–50, un proveedor, dos escenarios

No es marketing todavía. Es la medición que decide si el producto tiene una razón de existir.

### Escenario 1 — Structuring (el que importa)
**Hipótesis:** con un cap por transacción de USD 10 y sin cap acumulado, el agente gasta más que el cap
haciendo cargos chicos.

- Config: `transactionLimits: TRANSACTION`, monto USD 10. Sin límite LIFETIME.
- Ejecución: dos cargos de USD 9 en un merchant que permita compras repetidas chicas — top-up de
  créditos de API es lo ideal.
- **Pasa el bypass** si los dos cargos entran: USD 18 gastados con un cap de USD 10.
- **Se bloquea** con la config hardened: `LIFETIME` en USD 10 además del per-tx.
- Costo: USD 18, dentro del cap de USD 20 de Interlace.

### Escenario 2 — Suscripción zombie
**Hipótesis:** la tarea termina, la tarjeta queda viva y la suscripción sigue cobrando.

**Ojo con esto:** tiene dependencia de calendario. La renovación real llega en 30 días, así que el
resultado definitivo no está la semana que viene. Dos vías:

- **Proxy rápido (hoy):** suscribirse, marcar la tarea como completada, e intentar un segundo cargo en
  el mismo merchant. Si entra, la tarjeta sobrevivió a su propósito. Costo: ~USD 2–10.
- **Real (30 días):** dejar la suscripción viva y ver si renueva. Arrancarlo ahora para que reporte
  solo. Cancelarla apenas se registre el resultado.

### Qué se registra
Por cada intento: config exacta, monto, merchant, timestamp, resultado (aprobado/rechazado), y el
código de rechazo si lo hay. Sin eso no es una medición, es una anécdota.

### Criterio de muerte
Si ninguno de los dos bypasses entra con la config permisiva del proveedor, **el wrapper no tiene
razón de existir** y hay que decidir de nuevo. Ese es el punto del test: que pueda salir mal barato.

---

## 5. v1 del wrapper — dos semanas después del test

**Tools MCP** (fachada sobre el proveedor, con la policy adentro):

| Tool | Qué hace |
|---|---|
| `get_budget` | total, gastado, restante |
| `request_card` | `amount`, `merchant`, `reason`, `ttl`. Devuelve handle, no PAN |
| `card_status` | estado, cargos, motivo de rechazo |
| `close_card` | cierra ya |
| `list_charges` | cargos con la tarea que los causó |

**Defaults seguros de fábrica** — el producto de verdad:
- `LIFETIME` obligatorio, siempre, además del per-tx. No se puede crear una tarjeta sin cap acumulado.
- TTL obligatorio con cierre automático. Ninguna tarjeta vive para siempre.
- Allowlist de merchant por defecto, no blacklist.
- Kill switch global.

**Recibos:** cada cargo → agente, tarea, motivo, monto, merchant. Export CSV.

**Español primero.** Errores, docs y onboarding. Es la mitad del diferenciador y cuesta casi nada.

**Funding:** USDC en Solana. Un proveedor. USD.

### Fuera de v1
Multi-proveedor. Multichain. Tarjetas físicas. Equipos/orgs. Dashboard más allá de una página. Token.

---

## 6. Precio

El interchange es del emisor. Nuestra opción realista: **fee por agente/mes**, apuntado a un dev solo
o un equipo chico — no el ticket de EE.UU. Con 20 devs pagando ya hay señal; no necesita volumen.

Alternativa a evitar: spread sobre el funding. Acerca peligrosamente a tocar fondos de terceros.

### Decisión abierta: ¿de quién es la cuenta con Interlace?

Sin resolver al 21 ago 2026. Se decide después del test, con datos reales. Cambia el precio, el
onboarding y a qué obligaciones legales quedamos expuestos, así que no se decide de taquito.

**Opción A — reseller.** La cuenta es nuestra. El usuario paga acá y nunca ve a Interlace. Mejor
producto y mejor marca, pero heredamos compliance y KYC, y quedamos más cerca de la línea de
transmisión de dinero que §3.2 dice no cruzar.

**Opción B — bring your own account.** El usuario trae su propia API key de Interlace y nosotros
somos solo el software encima. Riesgo legal casi nulo y arranque más rápido, pero más fricción en el
onboarding y el usuario ve de entrada que somos un wrapper — que es justo lo que §1 admite que somos.

Lo que hay que mirar en el test para decidir: cuánta fricción real tiene el alta en Interlace desde
Argentina. Si es fácil, B alcanza. Si es un dolor, A es el producto.

---

## 7. OmniHood

Sin rol técnico. Distribución marginal (229 holders). La relación con el fundador vale por su red
LATAM, no por su stack ni por su token. Detalle en `omnihood-analysis.md`.

---

## 8. Primer movimiento

1. Alta en Interlace, API key, y **emitir una tarjeta**. Verificar que se puede desde Argentina.
2. Un cargo online real de USD 5 en un SaaS. Si esto falla, nada de lo demás importa.
3. Escenario 1 con USD 18. Registrar todo.
4. Arrancar el escenario 2 en su versión de 30 días y hacer el proxy rápido.
5. Con esos datos en la mano, recién ahí codear el wrapper.
