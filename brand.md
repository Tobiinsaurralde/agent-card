# Brand — agent-card

_Status: active_

## Posicionamiento

**La tarjeta que sabe decir que no.** agent-card es infraestructura de control de gasto para agentes
de IA. La marca comunica lo que comunica un buen banco: precisión, sobriedad y cero teatro. El
momento heroico del producto no es un pago aprobado — es un rechazo con un motivo exacto.

## Voz y tono

- Español rioplatense profesional. Voseo sin caer en chiste.
- Frases cortas, voz activa, números concretos. "Cortó en USD 9.00", no "el sistema procedió a limitar".
- La honestidad es parte de la marca: si es una simulación, se dice arriba y en grande.
- Nunca prometer lo que hace el emisor. Nosotros decidimos; el rail cobra.

## Logo

Robot + tarjeta + escudo + candado, con el degradé azul→dorado de la marca. Dos versiones en
`public/`: `logo.png` (fondo oscuro, para redes y avatares) y `logo-light.png` (fondo claro, la que
usa el sitio: favicon y marca de nav/footer, siempre como tile redondeado con borde `border`).
El logo no se recolorea ni se estira; a menos de 24px se usa solo el favicon.

## Tipografía

| Uso | Fuente | Notas |
|---|---|---|
| UI | **Inter Variable** (self-hosted, `@fontsource-variable/inter`) | tracking apretado en títulos (`tracking-tight`) |
| Números, códigos, montos | **JetBrains Mono Variable** (`@fontsource-variable/jetbrains-mono`) | siempre con `tabular-nums`; los montos nunca saltan de ancho |

Regla: todo monto, código de decisión, PAN y contador va en mono. Todo lo demás en Inter.

## Paleta

Grises fríos (matiz ~260), un solo acento azul, y semánticos solo con significado semántico.

### Dupla de marca: azul + dorado

El azul es el color de **todo lo interactivo e informacional**: foco, enlaces, selección, iconos de
feature. El dorado (`gold`, oklch `0.85 0.13 92` en oscuro / `0.58 0.12 90` en claro) es el color de
**marca pura** y aparece solo en cuatro lugares: los kickers de sección (mono, tracking ancho), el
highlight del H1, el chip EMV de la tarjeta y un brillo radial ≤8% de opacidad. Reglas duras del
dorado: nunca un relleno grande, nunca un botón, nunca texto largo. Si el dorado aparece en más de
cuatro lugares por pantalla, se pasó de la raya.

### Oscuro (preferido)

| Token | oklch | Uso |
|---|---|---|
| `background` | `0.13 0.006 260` | fondo base |
| `card` | `0.165 0.007 260` | superficie elevada 1 |
| `muted` | `0.21 0.008 260` | superficie elevada 2, chips |
| `border` | `0.27 0.01 260` | bordes 1px |
| `foreground` | `0.93 0.004 260` | texto (blanco suave, nunca puro) |
| `muted-foreground` | `0.71 0.012 260` | texto secundario (≥4.5:1) |
| `primary` | `0.93 0.004 260` | CTA (botón claro sobre oscuro, estilo Mercury) |
| `accent` | `0.66 0.16 255` | foco, enlaces, selección, marca |
| `success` | `0.74 0.15 155` | aprobado |
| `destructive` | `0.68 0.19 24` | rechazado, kill |
| `warning` | `0.8 0.14 80` | cerca del cap |

### Claro

Mismos matices con luminancias invertidas; acento `0.5 0.19 255` para AA sobre blanco.

### La tarjeta (el objeto)

Gradiente propio de marca: de `oklch(0.23 0.03 265)` a `oklch(0.16 0.02 250)` con brillo radial
sutil arriba a la izquierda. Es el único lugar con gradiente en todo el producto.

## Motion

Vocabulario cerrado: 100 ms (feedback hover/press), 150 ms (entradas chicas), 200–250 ms (filas del
ledger, cambios de estado de la tarjeta). Easing `ease-out` para entrar, `ease-in` para salir. Nada
más largo que 300 ms. Todo se apaga con `prefers-reduced-motion`.

## Reglas duras

1. Verde solo para aprobado. Rojo solo para rechazado/destruir. Ámbar solo para advertir.
2. Un gradiente en todo el producto: la tarjeta. El resto es plano con bordes.
3. Los montos siempre con dos decimales y en mono tabular.
4. El aviso de simulación no se esconde.
