#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# CONSTRUTIVO AI — Script de Importação de Dados
# Uso: execute no SERVIDOR DESTINO (novo servidor) após os containers
#      estarem rodando e o arquivo de dump ter sido copiado.
#
#   chmod +x db/migrar_importar.sh
#   ./db/migrar_importar.sh dump_construtivo_2025-01-01.sql
#
# ══════════════════════════════════════════════════════════════════════
set -e

CONTAINER="construtivo-obras-db"
DB_USER="${DB_USER:-construtivo}"
DB_NAME="${DB_NAME:-construtivo_obras}"
ARQUIVO="${1:-}"

echo "============================================"
echo " CONSTRUTIVO AI — Importação de Dados"
echo "============================================"

# Valida argumento
if [ -z "$ARQUIVO" ]; then
  echo "❌ Informe o arquivo de dump como argumento."
  echo "   Uso: ./migrar_importar.sh dump_construtivo_2025-01-01.sql"
  exit 1
fi

if [ ! -f "$ARQUIVO" ]; then
  echo "❌ Arquivo não encontrado: $ARQUIVO"
  exit 1
fi

echo " Container : $CONTAINER"
echo " Banco     : $DB_NAME"
echo " Usuário   : $DB_USER"
echo " Arquivo   : $ARQUIVO ($(du -sh "$ARQUIVO" | cut -f1))"
echo "--------------------------------------------"
echo ""

# Verifica se container está healthy
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌ Container '$CONTAINER' não está em execução."
  echo "   Execute primeiro: docker compose up -d"
  exit 1
fi

echo "⚠️  ATENÇÃO: Esta operação vai INSERIR dados no banco '$DB_NAME'."
echo "   Se o banco já tiver dados, pode haver conflitos de ID."
echo "   Recomendado apenas em banco recém-criado (vazio)."
echo ""
read -rp "Confirma a importação? (s/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[sS]$ ]]; then
  echo "Operação cancelada."
  exit 0
fi

echo ""
echo "[1/4] Desabilitando triggers temporariamente..."

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SET session_replication_role = 'replica';" 2>/dev/null || true

echo "[2/4] Importando dados (aguarde)..."

# Importa o dump — usa session_replication_role para desabilitar FKs durante import
docker exec "$CONTAINER" psql \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "SET session_replication_role = 'replica';" \
  -f "/dev/stdin" < "$ARQUIVO"

echo "[3/4] Reabilitando triggers e revalidando constraints..."

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" << 'SQL'
SET session_replication_role = 'origin';

-- Verifica integridade referencial das principais tabelas
DO $$
DECLARE
  erros INTEGER := 0;
BEGIN
  -- obras sem empresa
  SELECT COUNT(*) INTO erros FROM obras o
    WHERE NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = o.empresa_id);
  IF erros > 0 THEN RAISE WARNING 'obras sem empresa válida: %', erros; END IF;

  -- contratos sem obra
  SELECT COUNT(*) INTO erros FROM contratos c
    WHERE NOT EXISTS (SELECT 1 FROM obras o WHERE o.id = c.obra_id);
  IF erros > 0 THEN RAISE WARNING 'contratos sem obra válida: %', erros; END IF;

  -- medicoes sem contrato
  SELECT COUNT(*) INTO erros FROM medicoes m
    WHERE NOT EXISTS (SELECT 1 FROM contratos c WHERE c.id = m.contrato_id);
  IF erros > 0 THEN RAISE WARNING 'medições sem contrato válido: %', erros; END IF;

  RAISE NOTICE 'Validação de integridade concluída.';
END$$;
SQL

echo "[4/4] Gerando relatório de contagem..."

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" << 'SQL'
SELECT
  'empresas'              AS tabela, COUNT(*) AS registros FROM empresas    UNION ALL
SELECT 'obras',                                COUNT(*)     FROM obras       UNION ALL
SELECT 'fornecedores',                         COUNT(*)     FROM fornecedores UNION ALL
SELECT 'contratos',                            COUNT(*)     FROM contratos   UNION ALL
SELECT 'contrato_itens',                       COUNT(*)     FROM contrato_itens UNION ALL
SELECT 'medicoes',                             COUNT(*)     FROM medicoes    UNION ALL
SELECT 'medicao_itens',                        COUNT(*)     FROM medicao_itens UNION ALL
SELECT 'aprovacoes',                           COUNT(*)     FROM aprovacoes  UNION ALL
SELECT 'evidencias',                           COUNT(*)     FROM evidencias  UNION ALL
SELECT 'alcadas',                              COUNT(*)     FROM alcadas     UNION ALL
SELECT 'configuracoes',                        COUNT(*)     FROM configuracoes UNION ALL
SELECT 'usuarios',                             COUNT(*)     FROM usuarios    UNION ALL
SELECT 'portal_nfs',                           COUNT(*)     FROM portal_nfs  UNION ALL
SELECT 'audit_logs',                           COUNT(*)     FROM audit_logs
ORDER BY tabela;
SQL

echo ""
echo "============================================"
echo " ✅ Importação concluída!"
echo "============================================"
echo ""
echo "Próximos passos:"
echo "  1. Verifique os counts acima vs. o banco de origem"
echo "  2. Faça login no sistema e confira os dados"
echo "  3. Execute: docker compose logs --tail=30 construtivo-api"
echo ""
