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

Minimalismo de imprenta sobre crema: una sola superficie cálida, objetos blancos con borde
visible y **sombra dura desplazada** (papel apilado, nunca blur), y una grotesca pesada para
display. La palabra clave de un título va con resaltador dorado; el "NO." del hero va como
sello con borde. Sin gradientes de fondo, sin orbes, sin grain, sin píldoras.

| Elemento | Regla |
|---|---|
| Fondo | Crema única `oklch(0.96 0.009 85)`. Nunca blanco puro ni secciones de color. |
| Superficies | Blanco cálido, `rounded-xl`, borde 1px `foreground/20`, `shadow-soft` (3px sólida). Hover: se corren −0.5px y pasan a `shadow-float` (7px sólida). |
| Botones y nav | Rectángulos `rounded-lg`. Azul = acción principal, tinta = nav, blanco bordeado = secundario. Al apretar se hunden 1px y pierden la sombra. |
| Navbar | Barra plana pegada arriba con borde inferior; links en **mono mayúscula trackeada**, CTA rectangular de tinta. |
| Objetos oscuros | Solo la tarjeta virtual y la mini terminal. Tinta `oklch(0.19 0.022 265)`. |
| Composición hero | Centrado: titular gigante con el sello, y abajo el flujo `policy → card → decision` como diagrama en fila con flechas doradas y etiquetas mono. |
| Cinta | Marquee continuo con los defaults en mono, separados por `✦` dorados, entre dos bordes. |

## Logo

Robot + tarjeta + escudo + candado. Dos versiones en `public/`: `logo.png` (fondo oscuro,
redes y avatares) y `logo-light.png` (fondo claro, favicon y nav/footer, siempre como tile
redondeado con borde). No se recolorea ni se estira; a menos de 24px se usa solo el favicon.

## Tipografía

| Uso | Fuente | Notas |
|---|---|---|
| Display (H1, H2, wordmark) | **Bricolage Grotesque Variable** ~780 | `.font-display` fija peso y tracking (−0.025em). La palabra acentuada lleva resaltador dorado (`.display-accent`), nunca itálica. |
| UI / cuerpo | **Inter Variable** | tracking apretado en labels |
| Números, códigos, montos, nav | **JetBrains Mono Variable** | siempre `tabular-nums` (`.num`); links de navbar en mayúscula con tracking 0.18em |

Acentos de título, tres herramientas y nada más:

- `.display-accent` — resaltador dorado detrás de la palabra clave (adapta opacidad en oscuro vía `--marker`).
- `.display-stamp` — el "NO." del hero: borde dorado, apenas rotado, como sello de goma.
- `.text-outline` — números gigantes en contorno dorado (`-webkit-text-stroke`), para pasos y principios.

Regla: todo monto, código de decisión, PAN y contador va en mono. Los títulos van en grotesca.

## Color: azul + oro sobre crema

El azul cobalto `oklch(0.45 0.19 262)` es **acción**: CTA principal, links, foco, paso activo.
El oro `oklch(0.52 0.11 82)` es **marca y énfasis**: resaltador y sello de los títulos, tags
de sección bordeadas en mono, flechas del diagrama, números en contorno. El verde no existe
fuera de APROBADO.

### Claro (default)

| Token | oklch | Uso |
|---|---|---|
| `background` | `0.96 0.009 85` | crema base |
| `card` | `0.993 0.003 85` | superficies |
| `foreground` | `0.22 0.022 265` | tinta |
| `primary` | `0.23 0.025 265` | botones de tinta |
| `accent` | `0.45 0.19 262` | azul de acción |
| `gold` | `0.52 0.11 82` | énfasis de marca |
| `success` | `0.52 0.14 155` | aprobado |
| `destructive` | `0.55 0.2 24` | rechazado, kill |

### Oscuro (toggle del panel y el simulador)

Tinta azul profunda, no negro: `background 0.165 0.02 265`, `card 0.205 0.025 265`,
texto crema `0.93 0.01 85`, azul aclarado `0.72 0.13 258`, oro `0.84 0.12 90`.
`primary` se invierte (botón crema, texto tinta), la sombra dura pasa a negro 38% y el
resaltador baja a 26% de opacidad (`--marker`). La landing pública es solo clara.

### La tarjeta (el objeto)

Gradiente propio fijo de `oklch(0.23 0.03 265)` a `oklch(0.15 0.02 250)`: una tarjeta no
cambia de color con el tema. Wordmark en grotesca, chip EMV ámbar. Es, junto con la
terminal, el único objeto oscuro del modo claro. Sin tilt: quieta, con shine al hover.

## Motion

- Hero: entrada escalonada `rise-focus` (sube + desenfoca a foco, 550 ms).
- Scroll: reveal 500 ms con blur, una vez.
- Terminal del hero: las líneas entran una por una y el cursor `▌` titila.
- Marquee: 30 s lineal, loop.
- Hover en cards: se corren −0.5px en diagonal y la sombra dura crece (`shadow-float`).
- Botones al apretar: +1px en diagonal y pierden la sombra (se "hunden").

Nada flota en loop: los objetos están apoyados, no suspendidos. Todo muere con
`prefers-reduced-motion`.

## Reglas duras

1. Verde solo para aprobado. Rojo solo para rechazado/destruir. Ámbar semántico solo para advertir.
2. Un solo fondo: crema. Si una sección pide su propio color de fondo, está mal planteada.
3. Los montos siempre con dos decimales y en mono tabular.
4. El aviso de simulación no se esconde.
5. La grotesca es display: nunca en cuerpo de texto ni en labels de formularios.
6. Nada de píldoras: interactivo = `rounded-lg`, tags y chips = `rounded-md`, superficies = `rounded-xl`.
7. Las sombras son sólidas y desplazadas. Un blur en una sombra es un bug.
