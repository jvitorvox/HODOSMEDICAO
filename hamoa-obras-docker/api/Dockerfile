# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./

# Instala dependências principais (sem mpxj — evita falha no postinstall)
RUN npm install --omit=dev

# Tenta instalar mpxj separadamente sem executar scripts de pós-instalação.
# Os JARs já vêm empacotados no tarball; o postinstall só faz verificação
# de ambiente e pode falhar em Alpine sem Java. Se falhar, ignora — a API
# detecta a ausência e orienta o usuário a exportar como XML.
RUN apk add --no-cache openjdk17-jre-headless && \
    npm install mpxj@13.5.0 --ignore-scripts --no-save 2>/dev/null || \
    (echo "⚠️  mpxj não instalado — suporte a .mpp indisponível (use .xml)" && true)

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine

# tini + curl + Java (runtime do mpxj para leitura de arquivos .mpp)
RUN apk add --no-cache tini curl openjdk17-jre-headless

# Usuário não-root
RUN addgroup -S hamoa && adduser -S hamoa -G hamoa

WORKDIR /app

# Copia dependências do build (inclui mpxj se instalação acima teve êxito)
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
