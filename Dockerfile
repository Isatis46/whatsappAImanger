FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN --mount=type=secret,id=build_ca if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN --mount=type=secret,id=build_ca if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_URL=http://api:4000
RUN pnpm build

FROM build AS server-dependencies
RUN --mount=type=secret,id=build_ca if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; pnpm --filter whatsapp-ai-manager deploy --prod --legacy /runtime

FROM node:24.19.0-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-dependencies --chown=node:node /runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/packages/persistence/migrations ./packages/persistence/migrations
RUN mkdir -p /app/.local/exports && chown -R node:node /app/.local
USER node
EXPOSE 4000
CMD ["node", "dist/apps/api/src/main.js"]

FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/admin-web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin-web/.next/static ./apps/admin-web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/admin-web/server.js"]
