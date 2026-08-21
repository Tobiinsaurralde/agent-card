# OmniHood — análisis completo

Due diligence al 21 ago 2026. Fuentes: omnihood.fun, omnihood.fun/docs, DexScreener,
GeckoTerminal, X (@0xSebasDev / @omnihoodfun), Celo Forum.

---

## 1. Veredicto en una línea

Proyecto real, fundador real y competente, pero **el producto es un agregador de terceros construido
en 3 días, su token es un lanzamiento fallido ($14–27k mcap, 229 holders) y su tarjeta explícitamente
no funciona bien para compras online** — que es el 100% del caso de uso de un agente.

**No va en el camino crítico. El activo aprovechable es el fundador, no el stack ni el token.**

---

## 2. Qué es realmente

Hub cross-chain con cuatro productos: swap/bridge, tarjeta Visa virtual, launcher de tokens y
liquidez/staking. Sobre 7 cadenas: Solana, Ethereum, Base, BNB, Avalanche, Robinhood Chain, Stablechain.

**Nada de eso es tecnología propia.** Según sus propios docs:

| Producto | Qué hay debajo |
|---|---|
| Swap & bridge | "Routed automatically through **Relay + Jupiter**" |
| Launcher | **LayerZero OFT**, $3 por cadena |
| Tarjeta | Un **card issuer sin nombrar**. "PAN y CVV viven solo en el issuer" |
| Token | **Pons** (launchpad de Robinhood Chain) |

Es capa de integración sobre cuatro proveedores. El propio fundador lo resume en un tweet:
*"A recap of what was achieved over these **3 days**: an entire swap system... 6 chains available...
**a non-KYC card provider**..."*

Tres días explica la profundidad. No hay nada acá que no se pueda reconstruir integrando los mismos
cuatro proveedores.

---

## 3. El hallazgo que mata la tesis "construir sobre OmniHood"

Anuncio público del fundador al lanzar la tarjeta:

> "issue your debit card without KYC. Since it is a no-KYC card, there is a minor limitation:
> **it does not work for some online purchases.** We recommend using it primarily for payments at
> **physical stores via Apple Pay, Samsung Pay, or Google Pay**, as well as at select online merchants."

Sus dos demos públicas: **un pago en un café** y **una donación en GoFundMe**.

Un agente de IA no puede apoyar un teléfono en un café. El caso de uso de un agente es
**card-not-present online al 100%**: SaaS, APIs, suscripciones, checkouts. Es exactamente el modo de
falla que el fundador admite.

El mecanismo es conocido y no se arregla del lado de OmniHood: las tarjetas no-KYC fallan online
porque no tienen verificación de dirección de facturación (AVS), no están enroladas en 3-D Secure, y
muchos merchants bloquean rangos de BIN prepagos marcados como riesgo. Las suscripciones recurrentes
son las que más rechazo tienen.

**Nota de credibilidad:** los docs dicen lo contrario que el fundador. Docs: *"use at any merchant that
accepts Visa online... Use them for online payments, subscriptions."* El fundador en X: online no
funciona confiablemente. Cuando la documentación contradice la admisión pública del propio dev, la
documentación es marketing.

---

## 4. El token: lanzamiento fallido, y en la cadena equivocada

`OMHD` — `0x06C60F07E985799eB7Ad014472F502Dac80692b5` — **Robinhood Chain**, pool Pons V1 / Uniswap v3.

| Métrica | DexScreener | GeckoTerminal |
|---|---|---|
| Market cap / FDV | $13,955 | $27,051 |
| Liquidez | $10,398 | $14,741 |
| Volumen 24h | $1,756 | $7,341 |
| Transacciones 24h | 17 (8 compras / 9 ventas) | 67 |
| Cambio 24h | −12.3% | −22.2% |
| Holders | — | **229** |
| Edad | creado 22 jul 2026 | 27 días |

(Snapshots distintos, de ahí la diferencia. El rango es el dato: **$14–27k de mcap, ~229 holders**.)

Contexto que lo empeora, no que lo justifica: lanzó en **Pons**, el launchpad dominante (~80% del
volumen de launchpads) de **Robinhood Chain**, la cadena más caliente del momento — $494M de TVL,
11.6M de transacciones diarias, la L2 con más ingresos de julio 2026, más que Base y Arbitrum juntas.
Con ese viento de cola, sacar $14k de mcap y 17 trades en 24h no es "temprano", es un lanzamiento que
no prendió.

**Y la contradicción más elocuente:** OMHD tiene **un solo par, en una sola cadena**. El producto
estrella que venden es *"launch a token live on every chain from day one, 1:1 OFT, powered by
LayerZero"*. No lo usaron para su propio token. Si la feature funcionara y sirviera, OMHD estaría en 7
cadenas.

Para tu caso, además: el token está en **Robinhood Chain, no en Solana**. Tu tesis, tu audiencia y tu
producto son Solana. El token que supuestamente alinearía incentivos vive en otro ecosistema.

### Tokenomics que cambió tres veces en semanas
1. Lanzamiento: *"everyone will need to **stake 1 million tokens** to issue their card"*
2. Días después: *"We have **removed** the mandatory stake. You just need to top up $20 USD"*
3. Docs hoy: *"a small stake can unlock issuance **in some configurations**. It's toggleable and off in
   the default config."*

Utilidad del token abandonada en semanas. Lo que quedó: fee de creación de ~$5 que compra OMHD y quema
la mitad, más 1.5% de cashback en OMHD. Un sumidero de fees sobre un mercado de $14k no sostiene nada.

---

## 5. Banderas rojas estructurales (qué NO replicar)

Del propio `docs/products/cards`:

1. **Fondos comingled.** *"All card deposits **pool into one issuer account**, but per-wallet balances
   live in a separate on-chain-anchored ledger."* Es una cuenta ómnibus con ledger propio. Eso es
   custodia de fondos de terceros, con el riesgo legal que implica.
2. **Contradicción con su propia portada.** Home: *"Non-custodial by default."* Docs: el top-up sí
   toca infraestructura de OmniHood. Lo segundo es lo cierto.
3. **Retiros de una sola vía.** *"Currently withdrawals are one-way (crypto → card → spent as fiat).
   Full withdrawal support is on the roadmap."* Si depositás, no lo podés sacar. Si el proveedor cae,
   el saldo se va con él.
4. **El emisor no está nombrado en ningún lado.** No se puede evaluar el riesgo de la contraparte que
   tiene el dinero.
5. **Métricas en cero.** La sección "Real volume, right now" del home muestra `—` en las seis
   métricas: swaps, total swapped, card spend, cashback, OMHD quemado.

Lo bueno que sí hay que copiar: **el PAN nunca pasa por su servidor**, se busca directo del issuer al
browser. Coincide con la decisión de arquitectura del spec.

---

## 6. El fundador: el único activo real

**Sebastián Ramírez — @0xSebasDev**, Colombia.

- **Ex-founder de Decentra** — trabajaron en lo mismo, hay historia compartida.
- **Embajador de Celo Colombia**, con presencia verificable: Blockchain Summit Latam 2025, X Spaces
  del 3 dic 2025, posts en el foro de Celo.
- Estuvo en Argentina en dic 2025 (mencionado en el foro de Celo).
- Ship velocity real: swap cross-chain de 6 cadenas + reventa de tarjeta en 3 días.

No es anónimo, no es un scam, y no es un mal dev. Es un builder LATAM rápido que shippea shallow y
lanza el token antes de tener producto. Su red personal — Celo Colombia, circuito LATAM, contacto con
Superteam-adjacent — vale más que su token y que su stack.

---

## 7. Lo que este análisis sí te aporta para shippear

Tres cosas concretas, y son valiosas:

1. **Prueba de que el camino de emisión existe y es accesible.** Un dev solo, en LATAM, sin entidad,
   reventa un programa de tarjetas no-KYC y está en producción en días. La emisión es un problema
   resuelto y comprable. Confirma el "buy, don't build" del spec.
2. **Te define el proveedor que NO sirve.** Necesitás un programa que funcione **card-not-present
   online**, y eso implica KYC del titular (AVS + 3DS). El atajo no-KYC te deja con una tarjeta que
   solo tapea en locales físicos — inútil para agentes. Esta es la decisión de proveedor más
   importante del proyecto, y OmniHood ya pagó el costo de descubrirla.
3. **Te regala el diferenciador.** Su peor propiedad — pool comingled + retiros de una sola vía —
   es exactamente lo que resuelve el modelo delegate: los fondos quedan en la wallet del usuario, el
   límite es un allowance on-chain, y se revoca cuando querés. "Tu plata nunca es mía" es un
   posicionamiento concreto contra el incumbente que tenés más cerca.

---

## 8. Decisión

| Rol propuesto | Veredicto |
|---|---|
| Infra / stack | **No.** Todo es Relay + Jupiter + LayerZero + un issuer sin nombrar. |
| El Visa para agentes | **No.** No funciona online por admisión del fundador. |
| Alineación por token | **No.** $14–27k mcap, 229 holders, Robinhood Chain, utilidad abandonada. |
| Distribución | **Marginal.** 229 holders. El alcance es del fundador, no del proyecto. |
| Relación con el fundador | **Sí.** Ex-Decentra, Celo Colombia, red LATAM real. Vale mantenerla. |

**Qué hacer:** seguir con el spec propio, proveedor propio con KYC para que funcione online, modelo
delegate no custodial. Con Sebastián, relación de pares y posible canal — sin dependencia técnica,
sin token compartido, sin construirle credibilidad a cambio de reposts.

Si en algún momento quisiera integrarse de verdad, el precio de entrada son tres cosas por escrito:
**nombre del emisor/BIN, un cargo online (no Apple Pay en local) verificable, y acceso a API.** Sin
las tres, no entra al camino crítico.
