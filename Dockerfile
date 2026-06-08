# Production Multi-Stage Build

# Stage 1: Build Angular
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build:prod

# Stage 2: Production Image
FROM node:18-alpine

WORKDIR /app    

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./
COPY --from=build /app/db.js ./
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/runMigration.js ./
COPY --from=build /app/package*.json ./

RUN npm install --omit=dev --legacy-peer-deps

EXPOSE 3000

CMD ["node", "server.js"]
