# syntax=docker/dockerfile:1.7
# Multi-target build for Chula. Build context is the repository root:
#   docker build -f docker/Dockerfile --target backend  -t chula-api .
#   docker build -f docker/Dockerfile --target frontend -t chula-web .

ARG NODE_IMAGE=node:20-alpine

# ---------------------------------------------------------------------
# Backend dependencies (production only)
# ---------------------------------------------------------------------
FROM ${NODE_IMAGE} AS backend-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/backend/package.json src/backend/package.json
COPY src/frontend/package.json src/frontend/package.json
RUN npm ci --omit=dev --workspace=@chula/backend --include-workspace-root=false --no-audit --no-fund

# ---------------------------------------------------------------------
# Backend runtime: Express API, payment + WhatsApp webhooks
# ---------------------------------------------------------------------
FROM ${NODE_IMAGE} AS backend
ENV NODE_ENV=production \
    PORT=4310 \
    HOST=0.0.0.0
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=backend-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src/backend ./src/backend
USER node
EXPOSE 4310
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4310/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/backend/server.js"]

# ---------------------------------------------------------------------
# Frontend build (Vite)
# ---------------------------------------------------------------------
FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/backend/package.json src/backend/package.json
COPY src/frontend/package.json src/frontend/package.json
RUN npm ci --workspace=@chula/frontend --include-workspace-root=false --no-audit --no-fund
COPY src/frontend ./src/frontend
# Public, build-time values only (the anon key is safe to ship to browsers).
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_API_URL=""
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY} \
    VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace=@chula/frontend

# ---------------------------------------------------------------------
# Frontend runtime: static files + /api reverse proxy
# ---------------------------------------------------------------------
FROM nginx:1.27-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/src/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
