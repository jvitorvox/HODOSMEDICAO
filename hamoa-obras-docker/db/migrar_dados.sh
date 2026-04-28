#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# CONSTRUTIVO AI — Script de Migração de Dados
# Uso: execute no SERVIDOR ORIGEM (onde estão os dados atuais)
#
#   chmod +x db/migrar_dados.sh
#   ./db/migrar_dados.sh
#
# Gera o arquivo: dump_construtivo_YYYY-MM-DD.sql
# Depois copie para o novo servidor e execute migrar_importar.sh
# ══════════════════════════════════════════════════════════════════════
set -e

CONTAINER="construtivo-obras-db"
DB_USER="${DB_USER:-construtivo}"
DB_NAME="${DB_NAME:-construtivo_obras}"
ARQUIVO="dump_construtivo_$(date +%Y-%m-%d).sql"

echo "============================================"
echo " CONSTRUTIVO AI — Exportação de Dados"
echo "============================================"
echo " Container : $CONTAINER"
echo " Banco     : $DB_NAME"
echo " Usuário   : $DB_USER"
echo " Arquivo   : $ARQUIVO"
echo "--------------------------------------------"

# Verifica se container está rodando
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌ Container '$CONTAINER' não está em execução."
  echo "   Execute: docker compose up -d construtivo-db"
  exit 1
fi

echo ""
echo "[1/3] Exportando schema + dados..."

docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password \
  --data-only \
  --disable-triggers \
  --column-inserts \
  --rows-per-insert=500 \
  --table=empresas \
  --table=fornecedores \
  --table=obras \
  --table=alcadas \
  --table=configuracoes \
  --table=usuarios \
  --table=contratos \
  --table=contrato_itens \
  --table=medicoes \
  --table=medicao_itens \
  --table=evidencias \
  --table=aprovacoes \
  --table=cronogramas \
  --table=atividades_cronograma \
  --table=contratos_atividades \
  --table=portal_tokens \
  --table=portal_nfs \
  --table=whatsapp_tokens \
  --table=lbm_locais \
  --table=lbm_servicos \
  --table=lbm_servico_contratos \
  --table=lbm_progresso \
  --table=audit_logs \
  > "$ARQUIVO"

echo "[2/3] Gerando reset de sequences..."

# Adiciona reset de sequences ao final do dump para que novos registros
# não colidam com IDs já existentes
cat >> "$ARQUIVO" << 'SQLEOF'

-- ══════════════════════════════════════════════════════════════
-- Reset de sequences — executar APÓS importar todos os dados
-- ══════════════════════════════════════════════════════════════
SELECT setval('empresas_id_seq',              COALESCE((SELECT MAX(id) FROM empresas),              1));
SELECT setval('fornecedores_id_seq',          COALESCE((SELECT MAX(id) FROM fornecedores),          1));
SELECT setval('obras_id_seq',                 COALESCE((SELECT MAX(id) FROM obras),                 1));
SELECT setval('contratos_id_seq',             COALESCE((SELECT MAX(id) FROM contratos),             1));
SELECT setval('contrato_itens_id_seq',        COALESCE((SELECT MAX(id) FROM contrato_itens),        1));
SELECT setval('medicoes_id_seq',              COALESCE((SELECT MAX(id) FROM medicoes),              1));
SELECT setval('medicao_itens_id_seq',         COALESCE((SELECT MAX(id) FROM medicao_itens),         1));
SELECT setval('evidencias_id_seq',            COALESCE((SELECT MAX(id) FROM evidencias),            1));
SELECT setval('aprovacoes_id_seq',            COALESCE((SELECT MAX(id) FROM aprovacoes),            1));
SELECT setval('alcadas_id_seq',               COALESCE((SELECT MAX(id) FROM alcadas),               1));
SELECT setval('usuarios_id_seq',              COALESCE((SELECT MAX(id) FROM usuarios),              1));
SELECT setval('cronogramas_id_seq',           COALESCE((SELECT MAX(id) FROM cronogramas),           1));
SELECT setval('atividades_cronograma_id_seq', COALESCE((SELECT MAX(id) FROM atividades_cronograma), 1));
SELECT setval('contratos_atividades_id_seq',  COALESCE((SELECT MAX(id) FROM contratos_atividades),  1));
SELECT setval('portal_tokens_id_seq',         COALESCE((SELECT MAX(id) FROM portal_tokens),         1));
SELECT setval('portal_nfs_id_seq',            COALESCE((SELECT MAX(id) FROM portal_nfs),            1));
SELECT setval('whatsapp_tokens_id_seq',       COALESCE((SELECT MAX(id) FROM whatsapp_tokens),       1));
SELECT setval('lbm_locais_id_seq',            COALESCE((SELECT MAX(id) FROM lbm_locais),            1));
SELECT setval('lbm_servicos_id_seq',          COALESCE((SELECT MAX(id) FROM lbm_servicos),          1));
SELECT setval('lbm_servico_contratos_id_seq', COALESCE((SELECT MAX(id) FROM lbm_servico_contratos), 1));
SELECT setval('lbm_progresso_id_seq',         COALESCE((SELECT MAX(id) FROM lbm_progresso),         1));
SELECT setval('audit_logs_id_seq',            COALESCE((SELECT MAX(id) FROM audit_logs),            1));
SQLEOF

echo "[3/3] Verificando arquivo gerado..."

LINHAS=$(wc -l < "$ARQUIVO")
TAMANHO=$(du -sh "$ARQUIVO" | cut -f1)

echo ""
echo "============================================"
echo " ✅ Exportação concluída!"
echo "    Arquivo : $ARQUIVO"
echo "    Tamanho : $TAMANHO"
echo "    Linhas  : $LINHAS"
echo "============================================"
echo ""
echo "Próximos passos:"
echo "  1. Copie o arquivo para o novo servidor:"
echo "     scp $ARQUIVO usuario@NOVO_SERVIDOR:/opt/construtivo/db/"
echo ""
echo "  2. No novo servidor, execute:"
echo "     ./db/migrar_importar.sh $ARQUIVO"
echo ""
