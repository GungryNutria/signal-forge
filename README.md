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
