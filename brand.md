# Brand — agent-card

_Status: active_

## Posicionamiento

**The card that knows how to say no.** agent-card es infraestructura de control de gasto para
agentes de IA. La marca no es un banco gris: es un estudio de control. El momento heroico del
producto no es un pago aprobado — es un rechazo con un motivo exacto.

## Voz y tono

- Español rioplatense profesional. Voseo sin caer en chiste. La landing pública va en inglés.
- Frases cortas, voz activa, números concretos. "Cortó en USD 9.00", no "el sistema procedió a limitar".
- La honestidad es parte de la marca: si es una simulación, se dice arriba y en grande.
- Nunca prometemos lo que hace el emisor. Nosotros decidimos; el rail cobra.

## Logo

Robot + tarjeta + escudo + candado, con el degradé azul→dorado de la marca. Dos versiones en
`public/`: `logo.png` (fondo oscuro, para redes y avatares) y `logo-light.png` (fondo claro, favicon
y marca de nav/footer, siempre como tile redondeado con borde).
El logo no se recolorea ni se estira; a menos de 24px se usa solo el favicon.

## Tipografía

| Uso | Fuente | Notas |
|---|---|---|
| Display (H1, H2, wordmark, números de sección) | **Syne** 600–800 | tracking negativo, peso alto. Es la voz de marca. |
| UI / cuerpo | **Inter Variable** | tracking apretado en labels |
| Números, códigos, montos | **JetBrains Mono Variable** | siempre `tabular-nums` |

Regla: todo monto, código de decisión, PAN y contador va en mono. Los títulos de la landing van en
Syne. El resto en Inter.

## Superficie de marca: campos de color

La landing **no es blanca ni negra**. Vive en cuatro campos que recorren el degradé del logo:

| Campo | Token de fondo | Uso |
|---|---|---|
| Pergamino | `oklch(0.93 0.05 82)` | hero, nav — ámbar cálido, nunca `#fff` |
| Navy | `oklch(0.29 0.1 255)` | problem, principles, footer — cobalto con hatch diagonal |
| Oro | `oklch(0.86 0.1 85)` | defaults, CTA final |
| Hielo | `oklch(0.90 0.055 250)` | how-it-works |

Los tokens viven en `.landing` y los usan **la landing y el simulador**. El modo oscuro del
simulador no es negro: es el campo navy (`html.dark .landing`) con CTAs en oro.

### Dupla de marca: azul + dorado

El azul cobalto es **acción**: CTAs sobre pergamino, ink, orbes, links.
El oro es **marca y énfasis**: kickers, watermark "NO", barra de marca, CTAs sobre navy, chip EMV.
Los dos aparecen como **superficies**, no como acentos tímidos.

### Oscuro (simulador)

| Token | oklch | Uso |
|---|---|---|
| `background` | `0.13 0.006 260` | fondo base |
| `card` | `0.165 0.007 260` | superficie elevada 1 |
| `muted` | `0.21 0.008 260` | superficie elevada 2, chips |
| `border` | `0.27 0.01 260` | bordes 1px |
| `foreground` | `0.93 0.004 260` | texto |
| `accent` | `0.66 0.16 255` | foco, enlaces |
| `gold` | `0.85 0.13 92` | marca |
| `success` | `0.74 0.15 155` | aprobado |
| `destructive` | `0.68 0.19 24` | rechazado, kill |

### La tarjeta (el objeto)

Gradiente propio: de `oklch(0.23 0.03 265)` a `oklch(0.16 0.02 250)` con brillo radial y un glow
azul+oro (`card-glow`) cuando aparece en la landing. Sigue siendo el único objeto oscuro.

## Motion

- Hero: entrada escalonada 400 ms.
- Scroll: reveal 300 ms, una vez.
- Tarjeta: tilt 3D al puntero + shine al hover.
- Recibo: flotación 7 s.
- Orbes: drift ambiental 16–20 s.
- Barra de marca: slide 14 s.
- Grain fijo sobre toda la landing (`mix-blend-mode: multiply`).

Todo muere con `prefers-reduced-motion`.

## Reglas duras

1. Verde solo para aprobado. Rojo solo para rechazado/destruir. Ámbar semántico solo para advertir.
2. La landing no usa papel blanco ni negro plano. Si una sección se ve gris, está mal.
3. Los montos siempre con dos decimales y en mono tabular.
4. El aviso de simulación no se esconde.
5. Syne es para display. Inter no se usa en H1/H2 de la landing.
