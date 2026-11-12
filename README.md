This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Release y deploy (GitHub Actions + Coolify)

`.github/workflows/release.yml` corre en cada push a `main`: construye el `Dockerfile`, publica `ghcr.io/gungrynutria/signal-forge:<sha>` y `:latest` (con `GITHUB_TOKEN`, `packages: write`) y llama a Coolify para redesplegar. `workflow_dispatch` solo construye (sin push a GHCR ni deploy), para validar sin tocar `main`.

Endpoint de deploy de Coolify v4: `POST <instancia>/api/v1/deploy?uuid=<uuid-de-la-app>` con la cabecera `Authorization: Bearer <token>` (`force=true` reconstruye sin cache). Fuentes (consultadas el 2026-11-06): <https://coolify.io/docs/api-reference/api/operations/deploy-by-tag-or-uuid> (metodo, ruta `/deploy`, parametros `uuid`, `tag`, `force`) y <https://coolify.io/docs/api-reference/authorization> (prefijo `/api/v1` y Bearer). TODO: Verify contra Coolify 4.1.1 en T-21.

Secretos del repositorio (solo estos dos; si falta alguno el deploy se omite con un aviso):

- `COOLIFY_DEPLOY_URL`: URL completa, p. ej. `https://<coolify>/api/v1/deploy?uuid=<uuid-de-signalforge-web>`.
- `COOLIFY_TOKEN`: token de API de Coolify (Keys & Tokens > API tokens, permiso de deploy).

El paquete GHCR nace privado: en Coolify hay que registrar credenciales de GHCR o hacerlo publico (lo decide Edgardo en T-21).

## Tarea programada de Claude (investigación)

La investigación corre como tarea programada en claude.ai (suscripción Max) y envía una investigación por activo a `POST /api/v1/investigaciones`. No tiene llaves del broker ni acceso a la base: su única vía es esa API con su token. Las instrucciones que sigue están en [`investigacion/instrucciones-v1.md`](investigacion/instrucciones-v1.md) (versión `investigacion-v1`). Las pone en marcha Edgardo (T-22).

### 1. Generar el token

```bash
node scripts/generar-token.mjs
```

Imprime el token (`sfi_...`) y su SHA-256. El hash va como variable `INVESTIGADOR_TOKEN_SHA256` en Coolify (y se redespliega); el token en claro solo va en el paso 3. Revocar = cambiar el hash en Coolify y redesplegar.

### 2. Entorno en claude.ai

1. Crea un entorno propio con acceso a red **Custom** (lista de hosts permitidos) que incluya solo `signalforge.mejsoftware.com` y lo que necesite la búsqueda web.
2. Sin variables de entorno y sin otros secretos.

### 3. Network secret

En ese entorno agrega un *network secret* de tipo Bearer para el host `signalforge.mejsoftware.com` con el token del paso 1. El proxy de Anthropic añade la cabecera `Authorization` fuera de la VM, por eso las instrucciones no la llevan. (TODO: Verify en T-22 que la cabecera llega al servidor.)

### 4. Tarea programada

1. Repositorio: `GungryNutria/signal-forge`.
2. Entorno: el del paso 2.
3. **Quita todos los conectores.** Por defecto se incluyen todos los que tengas conectados; la tarea no necesita ninguno.
4. Prompt (mínimo): `Lee investigacion/instrucciones-v1.md y síguelo.`
5. Programación: cron `15 * * * *` en **UTC** (minuto 15 de cada hora; deja la investigación vigente para el ciclo de las :30 y el de las :00).

### 5. Verificación

- Revisa que la configuración solo tenga el network secret y ningún conector.
- Tras 2 corridas, `select activo, estado, version_instrucciones, recibida_en from investigaciones order by recibida_en desc` debe mostrar BTC/USD y SOL/USD `aceptada` con `investigacion-v1`.
- Vigila la cuota en `claude.ai/settings/usage` durante las primeras 48 h (24 corridas al día).

### Probar la API a mano

Con la app corriendo (`npm run build && npm run start`, con las variables de `.env.example`) y el token del paso 1:

```bash
TOKEN=sfi_...   # el token generado; no lo guardes en el repo
curl -sS -X POST http://127.0.0.1:3000/api/v1/investigaciones \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"clave_idempotencia":"inv:2026-11-06T18:BTC/USD","ejecucion_id":"2026-11-06T18","version_instrucciones":"investigacion-v1","activo":"BTC/USD","sentimiento":0.42,"noticia_fuerte":false,"confianza":0.8,"resumen":"Prueba manual.","fuentes":["https://example.com/nota"]}'
```

Responde `201` con `{"id","estado":"aceptada","recibida_en"}`; repetirlo da `200` con el mismo cuerpo.

## Tarea programada de Claude (decisor)

El decisor corre como tarea programada en claude.ai y, una vez por hora, pide un contexto a `POST /api/v1/decisor/contextos` y envía una decisión (`comprar` o `no_comprar`) por activo a `POST /api/v1/decisor/decisiones`. No tiene llaves del broker ni acceso a la base: su única vía es esa API con su propio token (`sfd_...`). Un `comprar` lo convierte el servidor en una propuesta de tamaño y salidas fijos que pasa por todas las reglas de riesgo. Las instrucciones que sigue están en [`decisor/instrucciones-v1.md`](decisor/instrucciones-v1.md) (versión `decisor-v1`). Las pone en marcha Edgardo con el `backend` (spec 004, T-14).

### 1. Generar el token

```bash
node scripts/generar-token.mjs --decisor
```

Imprime el token (`sfd_...`) y su SHA-256. El hash va como variable `DECISOR_TOKEN_SHA256` en Coolify (y se redespliega); el token en claro solo va en el paso 3. Revocar = cambiar el hash en Coolify y redesplegar. Sin `--decisor`, el script genera el del investigador (`sfi_...`); cada token solo sirve en las rutas de su rol (el del otro recibe `403`).

### 2. Entorno en claude.ai

1. Crea un entorno nuevo, `signalforge-decisor`, con acceso a red **Limited** y como único host permitido `signalforge.mejsoftware.com`. El decisor no busca en la web.
2. Sin variables de entorno y sin otros secretos.

### 3. Network secret

En ese entorno agrega un *network secret* de tipo Bearer para el host `signalforge.mejsoftware.com` con el token del paso 1. El proxy de Anthropic añade la cabecera `Authorization` fuera de la VM, por eso las instrucciones no la llevan.

### 4. Tarea programada

1. Repositorio: `GungryNutria/signal-forge`.
2. Entorno: `signalforge-decisor`.
3. **Quita todos los conectores.** Por defecto se incluyen todos los que tengas conectados; la tarea no necesita ninguno.
4. Prompt (mínimo): `Lee decisor/instrucciones-v1.md y síguelo.`
5. Modelo: Haiku (decisión D-7 de la spec 004; se sube a Sonnet solo si los razonamientos salen flojos y la cuota lo permite). TODO: Verify el nombre exacto del modelo en la interfaz de rutinas.
6. Programación: cron `45 * * * *` en **UTC** (minuto 45 de cada hora, que es el inicio de cada ranura del decisor). La interfaz solo ofrece "Hourly" sin minuto: como con el investigador, el minuto se ajusta por API.

### 5. Versión de las instrucciones

Cada decisión lleva `version_instrucciones = "decisor-v1@<id del modelo>"`. El modelo se declara solo (lo toma de su información de sistema), así que cambiar el modelo en la interfaz cambia la versión sin tocar el archivo. Regla: si cambias `decisor/instrucciones-v1.md` de forma que cambie el comportamiento, crea `decisor/instrucciones-v2.md` (versión `decisor-v2`) y actualiza el prompt de la tarea; un cambio solo de redacción no sube la versión. El servidor acepta `^decisor-v\d+@[A-Za-z0-9._\-]{1,48}$`. En la primera corrida comprueba qué id de modelo se guardó.

### 6. Verificación

- Revisa que la configuración solo tenga el network secret y ningún conector (captura sin secretos).
- Primero, con el decisor en `MODO_DECISOR=solo_registra`, haz una corrida manual: debe dar `201` en los dos activos y ninguna orden.
- Tras la corrida, `select activo, decision, estado, modo_efectivo, version_instrucciones, recibida_en from decisiones order by recibida_en desc` debe mostrar BTC/USD y SOL/USD con `aceptada` y la versión esperada.
- Vigila la cuota en `claude.ai/settings/usage` durante las primeras 48 h (24 corridas al día) y las corridas Failed o Cancelled del historial de la tarea.

### Probar la API del decisor a mano

Con la app corriendo (`npm run dev` o `npm run build && npm run start`, con las variables de `.env.example`, `DECISOR_TOKEN_SHA256` con el hash del token generado y `MODO_DECISOR=solo_registra`):

```bash
TOKEN=sfd_...   # el token generado; no lo guardes en el repo
curl -sS -X POST http://127.0.0.1:3000/api/v1/decisor/contextos \
  -H "Authorization: Bearer $TOKEN" -o /tmp/ctx.json -w '%{http_code}\n'
```

Responde `201` con el contexto (`contexto-v1`, con su `id`). Para enviar una decisión, usa ese `id` como `contexto_id` en el cuerpo que describe `decisor/instrucciones-v1.md` y envíalo a `/api/v1/decisor/decisiones` con la misma cabecera `Authorization`.

## Dataset y datos de prueba

- **Dataset (REQ-26):** `node dist/dataset.mjs [--activo BTC/USD]` escribe en stdout una línea JSON por evaluación del ciclo (la vista `v_dataset`). Solo hace `SELECT` y solo necesita `DATABASE_URL`.
- **Semillas:** `npx tsx scripts/sembrar.ts <escenario> [--reiniciar]` carga un escenario con horas relativas a "ahora" (`vacio`, `ejecutada-y-rechazada`, `casos-ac9`, `ejecuciones-por-caso`, `pausa-auto`, `ciclo-detenido-46`, `metricas-conocidas`, etc.; la lista completa está en `scripts/sembrar.ts`). Se niega si `APP_ENV` es `produccion` o no está definido. `--reiniciar` recrea el esquema y solo se permite con `APP_ENV=test` y una base cuyo nombre contenga `test` o `e2e`. Para `pausa-manual`, arranca la app con `TRADING_PAUSADO=true`.
- **Falla inyectada (solo `APP_ENV` `test` o `desarrollo`):** `SF_FALLA_INYECTADA=estadoSistema,listarPropuestas` hace fallar esas consultas del tablero para probar el error por bloque.
