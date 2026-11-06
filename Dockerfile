# syntax=docker/dockerfile:1
# Imagen unica para la web y los procesos (ciclo, vigilante, migrar). Sin secretos:
# todas las variables llegan en runtime (Coolify).

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:procesos

FROM node:24-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Next standalone (server.js + node_modules minimo), estaticos y publico.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Procesos empaquetados (autocontenidos) y migraciones.
COPY --from=build --chown=node:node /app/dist/*.mjs ./dist/
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "node dist/migrar.mjs && exec node server.js"]
