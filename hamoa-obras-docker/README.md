# 🏗 CONSTRUTIVO OBRAS — Guia de Deploy com Docker Compose

## Estrutura de arquivos

```
construtivo-obras/
├── docker-compose.yml       # Orquestração dos containers
├── .env.example             # Modelo de variáveis de ambiente
├── .env                     # Suas variáveis (NÃO versionar no Git!)
├── .gitignore
│
├── app/                     # Frontend
│   └── index.html           # → cole aqui o arquivo construtivo-obras.html
│
├── nginx/
│   ├── nginx.conf           # Configuração global do Nginx
│   └── default.conf         # Virtual host CONSTRUTIVO OBRAS
│
├── api/                     # Backend Node.js
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
│
├── db/
│   ├── init.sql             # Schema do banco de dados
│   └── seed.sql             # Dados iniciais
│
└── ssl/                     # Certificados SSL (produção)
    ├── construtivo.crt
    └── construtivo.key
```

---

## ⚡ Deploy rápido (5 minutos)

### 1. Pré-requisitos

```bash
# Verificar versões
docker --version          # >= 24.x
docker compose version    # >= 2.x
```

### 2. Preparar os arquivos

```bash
# Criar estrutura de diretórios
mkdir -p construtivo-obras/{app,nginx,api,db,ssl}
cd construtivo-obras

# Copiar todos os arquivos deste pacote para os diretórios corretos
# Copiar o construtivo-obras.html para app/index.html
cp /caminho/para/construtivo-obras.html app/index.html
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env   # edite com seus valores reais
```

**Campos obrigatórios:**
```env
DB_PASS=SuaSenhaSegura@2025
REDIS_PASS=RedisPassword@2025
JWT_SECRET=string-longa-e-aleatoria-minimo-32-chars
```

### 4. Subir os containers

```bash
# Modo produção (background)
docker compose up -d

# Verificar status
docker compose ps

# Ver logs em tempo real
docker compose logs -f
```

### 5. Verificar funcionamento

```bash
# Frontend
curl http://localhost/health

# API
curl http://localhost/api/health
```

Acesse: **http://localhost** no navegador.

---

## 🔧 Comandos úteis

```bash
# Parar tudo
docker compose down

# Parar e apagar volumes (⚠️ APAGA OS DADOS)
docker compose down -v

# Reiniciar apenas um serviço
docker compose restart construtivo-api

# Ver logs de um serviço específico
docker compose logs -f construtivo-api
docker compose logs -f construtivo-db

# Entrar no container do banco
docker compose exec construtivo-db psql -U construtivo -d construtivo_obras

# Entrar no container da API
docker compose exec construtivo-api sh

# Rebuild após mudanças no código da API
docker compose build construtivo-api
docker compose up -d construtivo-api

# Subir com o Adminer (gerenciador visual do banco)
docker compose --profile tools up -d
# Acesse: http://localhost:8080
# Sistema: PostgreSQL | Servidor: construtivo-db | Usuário: construtivo
```

---

## 🔐 Configuração LDAP/Active Directory

Após o deploy, acesse **Configurações → Autenticação LDAP/AD** e preencha:

| Campo | Exemplo |
|-------|---------|
| Servidor | `dc01.suaempresa.local` |
| Domínio | `SUAEMPRESA` |
| Base DN | `DC=suaempresa,DC=local` |
| Usuário de Serviço | `svc-construtivo@suaempresa.local` |

Ou configure direto no `.env`:

```env
LDAP_ENABLED=true
LDAP_URL=ldap://dc01.suaempresa.local:389
LDAP_BASE_DN=DC=suaempresa,DC=local
LDAP_DOMAIN=SUAEMPRESA
LDAP_BIND_DN=svc-construtivo@suaempresa.local
LDAP_BIND_PASS=senha-do-servico
```

---

## 🌐 Configuração para produção com HTTPS

### Opção A — Certificado próprio

```bash
# Gerar certificado autoassinado (desenvolvimento)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/construtivo.key -out ssl/construtivo.crt \
  -subj "/CN=construtivo.suaempresa.com.br"
```

### Opção B — Let's Encrypt com Certbot

```bash
# Adicionar ao docker-compose.yml:
# certbot:
#   image: certbot/certbot
#   volumes:
#     - ./ssl:/etc/letsencrypt
#   command: certonly --webroot -w /var/www/certbot -d construtivo.suaempresa.com.br

certbot certonly --standalone -d construtivo.suaempresa.com.br
cp /etc/letsencrypt/live/construtivo.suaempresa.com.br/fullchain.pem ssl/construtivo.crt
cp /etc/letsencrypt/live/construtivo.suaempresa.com.br/privkey.pem ssl/construtivo.key
```

Depois descomente as linhas SSL no `nginx/default.conf`.

---

## 💾 Backup do banco de dados

```bash
# Backup manual
docker compose exec construtivo-db pg_dump -U construtivo construtivo_obras > backup_$(date +%Y%m%d).sql

# Restaurar backup
cat backup_20250326.sql | docker compose exec -T construtivo-db psql -U construtivo -d construtivo_obras

# Backup automático com cron (adicionar no crontab do host)
0 2 * * * docker compose -f /opt/construtivo-obras/docker-compose.yml exec -T construtivo-db pg_dump -U construtivo construtivo_obras > /backups/construtivo_$(date +\%Y\%m\%d).sql
```

---

## 📊 Monitoramento

```bash
# Uso de recursos
docker stats

# Verificar saúde de cada container
docker compose ps

# Inspecionar um container
docker inspect construtivo-obras-api
```

---

## 🛠 Solução de problemas

| Problema | Solução |
|----------|---------|
| Porta 80 ocupada | Mude em `docker-compose.yml`: `"8090:80"` |
| API não conecta no banco | Verifique se `construtivo-db` está healthy: `docker compose ps` |
| Login não funciona | Verifique `DB_PASS` no `.env` e aguarde o banco inicializar |
| LDAP não conecta | Confirme que o container consegue resolver o hostname do DC |

---

## 📌 Portas utilizadas

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| Nginx (HTTP) | 80 | Frontend + proxy API |
| Nginx (HTTPS) | 443 | Frontend + proxy API (produção) |
| Node.js API | 3000 | API REST (interno) |
| PostgreSQL | 5432 | Banco de dados |
| Redis | 6379 | Cache/sessões |
| Adminer | 8080 | Admin do banco (profile tools) |

---

**CONSTRUTIVO OBRAS v3.0** · Docker Compose · © 2025
