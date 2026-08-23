# Medir si una tarjeta puede comprar online

Este es el test del que depende el proyecto. Todo lo demás asume que un agente puede
comprar online con una tarjeta acotada; acá se comprueba.

Se corre **dos veces**, y la comparación entre las dos corridas es el resultado:

1. Con una tarjeta virtual tuya, KYC-eada. Prueba que **la automatización** funciona.
2. Con la tarjeta del emisor candidato (OmniHood u otro). Prueba que **esa tarjeta** es aceptada.

Si la primera pasa y la segunda no, el problema es el programa de emisión y hay que cambiar
de emisor. Si ninguna pasa, el problema es nuestro código. Sin la primera corrida, un rechazo
en la segunda no prueba nada.

---

## Antes de empezar

**Usá una tarjeta virtual con límite bajo, nunca tu tarjeta principal.** La tarjeta termina
en el navegador que maneja el agente, que es exactamente el riesgo por el que existe este
producto. Cualquier banco o fintech que emita virtuales sirve.

**Un intento por corrida.** El código no reintenta nunca, y vos tampoco deberías contra el
mismo comercio. Reintentar un checkout con la misma tarjeta es la firma del *card testing*:
el banco te bloquea la tarjeta de verdad y el comercio te marca. Si necesitás otro intento,
cambiá de comercio.

**Cargá más de lo que vas a gastar.** Con USD 1 en la tarjeta y una compra de USD 1, un
rechazo es ambiguo entre "no la aceptan" y "no alcanzó por un centavo de conversión". Con
USD 5 y una compra de USD 1, cualquier rechazo es de aceptación.

## Preparar

```bash
cp .env.example .env
```

Y en `.env`:

```
AGENT_CARD_ALLOW_MANUAL_PAN=1
AGENT_CARD_TEST_PAN=4111 1111 1111 1111
AGENT_CARD_TEST_EXP=09/28
AGENT_CARD_TEST_CVC=123
AGENT_CARD_TEST_NAME=TU NOMBRE COMO FIGURA
```

`.env` está en `.gitignore`. No lo saques de ahí ni pegues esos valores en un chat o un issue.

Si el PAN está mal tipeado, el código corta antes de salir a la red: un número que no pasa
Luhn haría que el comercio conteste "datos inválidos" y concluiríamos que la tarjeta no sirve.

## Correr

Abrí Chrome con el puerto de depuración, en un perfil aparte para no tocar tus sesiones:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --user-data-dir=/tmp/agent-card-test
```

**Navegá a mano hasta la pantalla donde se pide la tarjeta.** Esto es importante y no es un
atajo: los checkouts reales son de varios pasos —carrito, monto, datos, y recién ahí la
tarjeta— y muchos son SPAs cuya URL no se puede volver a entrar. Por eso el modo normal es
`--here`, que trabaja sobre la pestaña que ya tenés abierta sin navegar a ningún lado.

Primero mirá si el formulario se entiende, que no cuesta nada ni toca la tarjeta:

```bash
npm run test:checkout -- --here --dry-run
```

Si dice `SE ENTIENDE`, ahí sí va el intento real:

```bash
npm run test:checkout -- --here
```

Empezá por un comercio permisivo y de monto chico: un dominio `.xyz` en Porkbun o Namecheap
sale ~USD 1-2 y es un checkout online real. Si pasa, repetí en uno estricto —una suscripción
SaaS— porque los comercios no son todos igual de exigentes y uno permisivo no generaliza.

`--url <url>` existe para el caso raro en que el formulario de tarjeta está en la URL de
entrada. Si dudás, es `--here`.

Con `--steel` usa una sesión de Steel en vez de tu Chrome, y ahí el captcha se resuelve solo.
Para la primera corrida no hace falta: si aparece un captcha, resolvelo a mano y listo. Conviene
así, porque separa la pregunta de la tarjeta de la pregunta del captcha.

### ¿Los selectores sirven?

Los campos de tarjeta suelen vivir en iframes del procesador, no en la página. Para Stripe
—que es lo que hay abajo de casi todo checkout de SaaS y créditos de API— está verificado
contra sus iframes reales:

```bash
npm run recon:stripe
```

Corrélo cuando toques `FIELD_SELECTORS` en `src/driver.ts`. El test del driver en `npm test`
usa un checkout falso que escribimos nosotros, así que por sí solo es circular: prueba que
nuestros selectores encuentran nuestro HTML. Este reconocimiento usa HTML de Stripe.

## Leer el resultado

| Veredicto | Qué significa |
|---|---|
| `APROBADO` (confianza alta) | La tarjeta compra online en ese comercio |
| `APROBADO` (confianza media) | Probablemente pasó, pero confirmá el cobro en el emisor |
| `RECHAZADO` | Mirá el motivo: la tabla de abajo dice si tiene arreglo |
| `DESAFIO_3DS` | Pidió verificación del banco. No es rechazo, pero un agente solo no lo pasa |
| `DESCONOCIDO` | No se pudo leer. Revisá en el emisor si el cobro entró, y **no reintentes** |

`DESCONOCIDO` es un resultado válido y a propósito: ante la duda el código no dice "rechazado",
porque un falso rechazo invita a reintentar, y reintentar un cobro que sí entró es cobrarle dos
veces al usuario.

### Los motivos de rechazo

Lo único que importa de cada motivo es si es **estructural**: si se arregla del lado nuestro o no.

| Motivo | ¿Estructural? | Qué hacer |
|---|---|---|
| `fondos_insuficientes` | no | Cargá más saldo |
| `datos_invalidos` | no | Bug del llenado: revisá los selectores |
| `tarjeta_vencida` | no | Emitir otra |
| `3ds_requerido` | **sí** | La tarjeta no está enrolada en 3-D Secure. Hace falta un emisor con KYC |
| `domicilio_no_verificado` | **sí** | Sin KYC no hay domicilio que verificar |
| `bin_no_aceptado` | **sí** | El comercio bloquea ese rango de BIN. Otro programa de emisión |
| `rechazo_generico` | **sí** | "Do not honor". Lo más común en prepagas sin KYC |
| `motivo_no_declarado` | **sí** | Rechazó sin decir por qué. Se asume estructural |

Los tres motivos estructurales del medio son exactamente los que hunden a una tarjeta sin KYC
en compras online, y son la razón por la que el fundador de OmniHood dijo que su tarjeta anda
en locales físicos y no online. Si el test devuelve alguno de esos con su tarjeta y la misma
compra pasa con la tuya, quedó probado y no hay código que lo arregle.

## Si dice que no pudo medir

`NO SE PUDO MEDIR` significa que no se entendió el formulario del comercio. **Eso es un bug
nuestro y no dice nada sobre la tarjeta.** El error lista los campos que había en la página;
con eso se agregan los selectores que falten en `FIELD_SELECTORS` (`src/driver.ts`) o se prueba
otro comercio.

Es una distinción que importa: confundir "no encontré el formulario" con "la tarjeta fue
rechazada" es la conclusión equivocada más cara del proyecto.
