# Brand — Konex

_Status: active_

## Posicionamiento

**The card that knows how to say no.** Konex es infraestructura de control de gasto para
agentes de IA. La marca no es un banco gris: es un estudio de control. El momento heroico del
producto no es un pago aprobado — es un rechazo con un motivo exacto.

## Voz y tono

- Español rioplatense profesional. Voseo sin caer en chiste. La landing pública va en inglés.
- Frases cortas, voz activa, números concretos. "Cortó en USD 9.00", no "el sistema procedió a limitar".
- La honestidad es parte de la marca: si es una simulación, se dice arriba y en grande.
- Nunca prometemos lo que hace el emisor. Nosotros decidimos; el rail cobra.
- Lo que es objetivo se dice como objetivo, nunca en presente. La landing no afirma nada
  que no esté en `src/`.

## Estética

Minimalismo editorial sobre crema: una sola superficie cálida, objetos blancos que flotan
con sombra suave, y una serif display gigante con la palabra clave en itálica dorada.
Sin gradientes de fondo, sin orbes, sin grain, sin campos de color por sección.

| Elemento | Regla |
|---|---|
| Fondo | Crema única `oklch(0.96 0.009 85)`. Nunca blanco puro ni secciones de color. |
| Superficies | Blanco cálido, `rounded-2xl/3xl`, borde 1px, `shadow-soft`. Flotan, no brillan. |
| Botones y nav | Píldoras (`rounded-full`). Azul = acción principal, tinta = nav, blanco bordeado = secundario. |
| Objetos oscuros | Solo la tarjeta virtual y la mini terminal. Tinta `oklch(0.19 0.022 265)`. |
| Composición hero | Tarjeta inclinada + ficha de specs + terminal, unidas por línea punteada, con float suave. |

## Logo

Robot + tarjeta + escudo + candado. Dos versiones en `public/`: `logo.png` (fondo oscuro,
redes y avatares) y `logo-light.png` (fondo claro, favicon y nav/footer, siempre como tile
redondeado con borde). No se recolorea ni se estira; a menos de 24px se usa solo el favicon.

## Tipografía

| Uso | Fuente | Notas |
|---|---|---|
| Display (H1, H2, números de sección, wordmark) | **Instrument Serif** 400 | un solo peso; la escala la da el tamaño, no la negrita. La palabra acentuada va en *itálica dorada* (`.display-accent`). |
| UI / cuerpo | **Inter Variable** | tracking apretado en labels |
| Números, códigos, montos | **JetBrains Mono Variable** | siempre `tabular-nums` (`.num`) |

Regla: todo monto, código de decisión, PAN y contador va en mono. Los títulos van en serif.
La serif nunca lleva `font-bold`: `.font-display` fija el peso en 400 para que el browser no
sintetice negritas.

## Color: azul + oro sobre crema

El azul cobalto `oklch(0.45 0.19 262)` es **acción**: CTA principal, links, foco, paso activo.
El oro `oklch(0.52 0.11 82)` es **marca y énfasis**: la palabra itálica de los títulos,
eyebrows en mono, íconos de principio, detalles. El verde no existe fuera de APROBADO.

### Claro (default)

| Token | oklch | Uso |
|---|---|---|
| `background` | `0.96 0.009 85` | crema base |
| `card` | `0.993 0.003 85` | superficies |
| `foreground` | `0.22 0.022 265` | tinta |
| `primary` | `0.23 0.025 265` | píldora de nav, botones de tinta |
| `accent` | `0.45 0.19 262` | azul de acción |
| `gold` | `0.52 0.11 82` | énfasis de marca |
| `success` | `0.52 0.14 155` | aprobado |
| `destructive` | `0.55 0.2 24` | rechazado, kill |

### Oscuro (toggle del panel y el simulador)

Tinta azul profunda, no negro: `background 0.165 0.02 265`, `card 0.205 0.025 265`,
texto crema `0.93 0.01 85`, azul aclarado `0.72 0.13 258`, oro `0.84 0.12 90`.
`primary` se invierte (píldora crema, texto tinta). La landing pública es solo clara.

### La tarjeta (el objeto)

Gradiente propio fijo de `oklch(0.23 0.03 265)` a `oklch(0.15 0.02 250)`: una tarjeta no
cambia de color con el tema. Wordmark en serif itálica, chip EMV ámbar. Es, junto con la
terminal, el único objeto oscuro del modo claro.

## Motion

- Hero: entrada escalonada 400 ms.
- Scroll: reveal 300 ms, una vez.
- Tarjeta: tilt 3D al puntero + shine al hover.
- Ficha de specs y terminal: float 7–9 s, con rotación estática leve (±3°).
- Hover en cards: lift 150 ms a `shadow-float`.

Todo muere con `prefers-reduced-motion`.

## Reglas duras

1. Verde solo para aprobado. Rojo solo para rechazado/destruir. Ámbar semántico solo para advertir.
2. Un solo fondo: crema. Si una sección pide su propio color de fondo, está mal planteada.
3. Los montos siempre con dos decimales y en mono tabular.
4. El aviso de simulación no se esconde.
5. La serif es display: nunca en cuerpo de texto ni en labels de formularios.
6. Interactivo = píldora. Tarjetas de contenido = `rounded-2xl/3xl`. Nada cuadrado.
