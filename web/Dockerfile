# syntax=docker/dockerfile:1
# --- deps: install exactly what package-lock.json pins ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile the Next.js app into a self-contained standalone server ---
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime: only the standalone server, static assets and public files ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Never run as root inside the container.
USER node
EXPOSE 3000
# API_URL (the Express service, read per request) is supplied at run time, not build time.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "server.js"]
