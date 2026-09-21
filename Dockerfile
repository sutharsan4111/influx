# Builds straight from this repo — no external staging folder. Matches the
# runtime that's actually deployed (node:18-alpine, no PowerShell: the Azure
# Backup collector uses @azure/identity + the REST API, never pwsh).

# ---- Stage 1: build the Angular frontend ----
FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY tsconfig*.json angular.json ./
COPY src ./src
RUN npm run build:prod

# ---- Stage 2: production runtime ----
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production

# Azure Backup collection writes here; persisted in Postgres, not this
# filesystem (see azure_backup_reports migration) — this dir is scratch only.
RUN mkdir -p /app/azure-monitoring && chown -R node:node /app/azure-monitoring

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY server.js db.js azure-backup-collector.js runMigration.js ./
COPY certs ./certs
COPY migrations ./migrations
COPY --from=build /app/dist/ticket-portal ./dist/ticket-portal

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
