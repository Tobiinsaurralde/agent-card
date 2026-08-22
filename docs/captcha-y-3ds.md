# CAPTCHA y 3DS en compras de agentes — investigación

_21 ago 2026_

## Respuesta corta

Sí, existe la API para resolver CAPTCHAs, es barata y es trivial de integrar. **Pero no es tu
problema principal, y usarla en un checkout es la peor decisión posible.** Lo que realmente frena a
un agente al pagar es el **3DS**, y ahí también hay una API — Interlace ya la expone, y es
exactamente donde vive nuestro motor de política.

---

## 1. Los solvers existen y son baratos

Patrón de integración idéntico en todos: `POST /createTask` con `sitekey` + `pageUrl` → polling a
`/getTaskResult` → te devuelve un token que inyectás en el form.

| Servicio | Tipo | reCAPTCHA v2 /1k | Turnstile /1k | Latencia | Éxito Turnstile |
|---|---|---|---|---|---|
| CapSolver | IA | $0.80 | $1.20 | 2–5 s | 89% |
| 2Captcha | humanos | $1.00–2.99 | $1.45 | 12–18 s | 97% |
| Anti-Captcha | humanos | $0.95–2.00 | $2.00 | 10–14 s | 95% |
| NopeCHA | IA | $0.60 | — | ~7 s | 82% |

Los precios son de abril–julio 2026. La IA es 4× más rápida y más barata; los humanos ganan en
Turnstile y en desafíos raros.

**El agujero que nadie menciona:** el token solo no alcanza. reCAPTCHA Enterprise y Turnstile en
modo estricto validan **server-side** que el fingerprint de la sesión y la reputación de la IP
coincidan con el token. Si resolvés el CAPTCHA desde un contexto distinto al que lo disparó, el token
es válido y la transacción igual se cae.

## 2. Por qué el checkout es el peor lugar para un solver

Tres razones concretas, en orden de gravedad:

**a) Te vas a ver como card testing.** Google reCAPTCHA tiene un producto específico —*Transaction
defense*— que puntúa justamente las páginas de pago buscando carding. Shopify bloquea ~90% de los
ataques de card testing en checkout de invitado con un modelo propio a nivel plataforma. El perfil de
un agente nuestro es: tarjeta virtual recién emitida, monto bajo, IP de datacenter, CAPTCHA resuelto
en 3 segundos. Eso **es** la firma de un ataque de card testing. No es que se parezca: es idéntica.

**b) El daño no cae en el merchant, cae en nuestro programa.** Los declines y los intentos fallidos
degradan la tasa de autorización del BIN y meten al programa en los programas de monitoreo de las
redes. Nosotros no somos el emisor: el que se come el problema es el proveedor que nos vendió la
emisión, y nos corta.

**c) Ningún proveedor de solver te cubre.** 2Captcha prohíbe explícitamente "buying any products or
services with stolen credit card"; CapSolver prohíbe "impersonation or deceptive fraud purposes" y
compra automática de tickets, y dice que colabora con las autoridades. CaptchaSolv directamente te
hace indemnizarlos por violar los ToS de terceros. Traducción: la violación de los términos del
merchant es 100% nuestra.

**Dato que lo cierra:** en el benchmark 2026 de checkout agéntico, el CAPTCHA es la causa #1 de fallo
(31% de los checkouts fallidos) y está clasificado como **"rarely recoverable"**. Los merchants
CAPTCHA-gated completan 28.7% de los intentos contra 88.4% de los agent-ready. Pelear el CAPTCHA es
pelear la pelea equivocada: la industria ya movió el problema a otro lado.

## 3. Lo que sí te bloquea: 3DS — y acá está tu producto

Un CAPTCHA lo resuelve un token. Un desafío 3DS necesita algo que **solo el emisor tiene**. Por eso
esto no se hackea: se integra.

Interlace —nuestro proveedor elegido— ya lo expone:

```json
// Webhook businessType: Card3dsOtp
{
  "data": {
    "cardId": "7c9cde3a-…",
    "amount": 100,
    "currency": "USD",
    "otp": "123456",
    "expireTime": "10",
    "detail": "Apple Pay"
  },
  "sign": "…"  // HMAC-SHA256 con el client secret
}
```

Y para responder: `POST /v2.0/3ds-answer` con `{ id, actionId, approve: boolean }`.

**Ese `approve: boolean` es nuestro motor de política.** El webhook trae monto, moneda y merchant —
exactamente los inputs de `evaluate()`. No hay que inventar nada: el punto de decisión del 3DS *es*
el punto de decisión de la política, y llega por webhook firmado, fuera del prompt. Un agente
jailbreakeado no puede aprobar su propio 3DS porque la decisión no pasa por él.

Ojo con dos cosas:

- El webhook exige respuesta en **5 segundos** y puede llegar duplicado. Hay que hacerlo idempotente
  por `requestId` — el propio Interlace avisa que el riesgo financiero por duplicados es del cliente.
- El OTP viene **en texto plano** en el payload. No se loguea, no se persiste, no pasa por ningún
  lugar donde no esté ya el resto de los secretos.

Otros que confirman que el patrón es estándar: Open Fabric expone flujos OOB y OTP con
`POST /v1/3ds/responses` y `challenge_result: approved|declined`; Visa Commercial Virtual
Authentication rutea el desafío del ACS al integrador. Y el SDK de CypherHQ agent-pay tiene
literalmente `pollAndApprove3ds(cardId)` — con el límite honesto de que devuelve
`requiresUserOtp: true` cuando el desafío exige al humano, y ahí el agente no puede seguir.

## 4. El camino legítimo para no comer CAPTCHAs: Web Bot Auth

Esto es lo que cambió en el último año y es la parte que más nos conviene: en vez de disfrazarnos de
humano, el agente **firma criptográficamente** quién es, y los WAF que lo verifican no le tiran
desafío.

Es **RFC 9421** (HTTP Message Signatures), gratis, descentralizado y self-serve:

1. Generás un par de claves Ed25519.
2. Publicás el JWKS en `/.well-known/http-message-signatures-directory` por HTTPS, **firmando la
   respuesta del directorio** (si no, cualquiera lo espeja y se registra en tu nombre).
3. Firmás cada request con los headers `Signature`, `Signature-Input` y `Signature-Agent`.
4. Te registrás en Cloudflare (cuenta gratis) → Account Home → Configurations → Verified Bots,
   método "Request Signature", y das la URL del directorio.

Los bots verificados **no reciben desafíos** de Bot Management. Ya lo soportan Cloudflare, AWS WAF,
Akamai, DataDome, Fingerprint, Shopify y Vercel; ya firman OpenAI, Browserbase y Manus. Fingerprint
tiene un endpoint público de test (`fingerprint.com/web-bot-auth/test/`) sin cuenta.

Encima de esto se montan **Visa Trusted Agent Protocol** y **Mastercard Agent Pay**: la misma firma
más un tag que distingue `agent-browser-auth` (navegar) de `agent-payer-auth` (pagar), atado al
dominio del merchant y con nonce anti-replay. Eso permite que el merchant sepa que el agente viene a
comprar y con permiso del usuario.

**El límite honesto:** el registro formal de Visa como Third Party Agent pide sponsor de un Visa
Client y certificación PCI DSS (AOC o SAQ-D-SP). Eso hoy no está a nuestro alcance. Web Bot Auth con
Cloudflare **sí** lo está, y es gratis.

## 5. La otra salida: que no haya formulario

**ACP (Agentic Commerce Protocol)** — OpenAI + Stripe + Meta, Apache 2.0, spec estable `2026-04-17`.
El agente no llena un checkout: llama endpoints y pasa un **delegated payment token** con un objeto
`allowance` (monto máximo, moneda, expiración). Sin forms, sin CAPTCHA, sin PAN.

Ese `allowance` es conceptualmente nuestra política. Vale seguirlo de cerca porque si ACP gana,
nuestro producto se vuelve "el que decide qué allowance emitir" en vez de "el que controla una
tarjeta".

**El límite honesto:** Instant Checkout de ChatGPT se retiró en marzo de 2026 después de que solo
~una docena de merchants Shopify lo implementaran. El protocolo sigue vivo, la cobertura de merchants
es fina. No es un camino usable hoy para comprar en cualquier lado.

## 6. Qué hacemos

**Decisión (21 ago 2026):** si aparece un captcha, se resuelve. El proveedor es **Steel**:
`solveCaptcha: true` + proxy residencial en la sesión del checkout. El captcha vive en
`src/browser.ts`, no en el MCP. El resultado entra al recibo.

3DS sigue siendo el muro de pago (Interlace `Card3dsOtp` + `/3ds-answer`). Web Bot Auth queda
como siguiente paso para que aparezcan menos desafíos.

## Fuentes

- Benchmarks de checkout agéntico 2026 — presenc.ai/research/agent-checkout-success-rate-benchmarks-2026
- Cloudflare, agentic commerce con Visa y Mastercard — blog.cloudflare.com/secure-agentic-commerce
- Cloudflare Web Bot Auth (docs y Verified Bots) — developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
- Visa Trusted Agent Protocol — developer.visa.com/capabilities/trusted-agent-protocol/docs · github.com/visa/trusted-agent-protocol
- Visa Third Party Agent Registration — partner.visa.com/site/programs/third-party-agent-registration.html
- Interlace webhooks y 3DS — developer.interlace.money/v2.0/docs/api-notifications · /v2.0/reference/3ds-answer
- Open Fabric 3DS — developer.openfabric.co/docs/AccountTokenization/VirtualCards/3DSecure
- ACP — github.com/agentic-commerce-protocol/agentic-commerce-protocol · docs.stripe.com/agentic-commerce/acp
- reCAPTCHA Transaction defense — docs.cloud.google.com/recaptcha/docs/fraud-prevention
- Shopify card testing — shopify.com/enterprise/blog/block-card-testing-attacks
- ToS de solvers — 2captcha.com/terms-of-service · capsolver.com/legal/terms
- Infra de browsers — docs.steel.dev/overview/pricinglimits · docs.anchorbrowser.io/pricing
