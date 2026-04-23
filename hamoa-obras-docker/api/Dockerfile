# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./

RUN npm install --omit=dev

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine

# tini (PID 1) + curl (healthcheck)
RUN apk add --no-cache tini curl

# Usuário não-root
RUN addgroup -S hamoa && adduser -S hamoa -G hamoa

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Diretórios de dados
RUN mkdir -p uploads logs && chown -R hamoa:hamoa /app

USER hamoa

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Usa tini como PID 1 (evita problemas de signal handling)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
