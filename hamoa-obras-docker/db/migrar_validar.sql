-- ══════════════════════════════════════════════════════════════════════
-- CONSTRUTIVO AI — Validação Pós-Migração
-- Execute no banco DESTINO após a importação:
--
--   docker exec -i construtivo-obras-db psql \
--     -U construtivo -d construtivo_obras < db/migrar_validar.sql
--
-- ══════════════════════════════════════════════════════════════════════

\echo '============================================'
\echo ' CONSTRUTIVO AI — Validação Pós-Migração'
\echo '============================================'

-- ── 1. Contagem por tabela ────────────────────────────────────────────
\echo ''
\echo '[1] Contagem de registros por tabela'
\echo '--------------------------------------------'

SELECT
  tabela,
  registros,
  CASE WHEN registros = 0 THEN '⚠️  vazia' ELSE '✅' END AS situacao
FROM (
  SELECT 'empresas'             AS tabela, COUNT(*) AS registros FROM empresas         UNION ALL
  SELECT 'obras',                          COUNT(*)              FROM obras             UNION ALL
  SELECT 'fornecedores',                   COUNT(*)              FROM fornecedores      UNION ALL
  SELECT 'contratos',                      COUNT(*)              FROM contratos         UNION ALL
  SELECT 'contrato_itens',                 COUNT(*)              FROM contrato_itens    UNION ALL
  SELECT 'medicoes',                       COUNT(*)              FROM medicoes          UNION ALL
  SELECT 'medicao_itens',                  COUNT(*)              FROM medicao_itens     UNION ALL
  SELECT 'aprovacoes',                     COUNT(*)              FROM aprovacoes        UNION ALL
  SELECT 'evidencias',                     COUNT(*)              FROM evidencias        UNION ALL
  SELECT 'alcadas',                        COUNT(*)              FROM alcadas           UNION ALL
  SELECT 'configuracoes',                  COUNT(*)              FROM configuracoes     UNION ALL
  SELECT 'usuarios',                       COUNT(*)              FROM usuarios          UNION ALL
  SELECT 'cronogramas',                    COUNT(*)              FROM cronogramas       UNION ALL
  SELECT 'atividades_cronograma',          COUNT(*)              FROM atividades_cronograma UNION ALL
  SELECT 'contratos_atividades',           COUNT(*)              FROM contratos_atividades  UNION ALL
  SELECT 'portal_tokens',                  COUNT(*)              FROM portal_tokens     UNION ALL
  SELECT 'portal_nfs',                     COUNT(*)              FROM portal_nfs        UNION ALL
  SELECT 'lbm_locais',                     COUNT(*)              FROM lbm_locais        UNION ALL
  SELECT 'lbm_servicos',                   COUNT(*)              FROM lbm_servicos      UNION ALL
  SELECT 'lbm_progresso',                  COUNT(*)              FROM lbm_progresso     UNION ALL
  SELECT 'audit_logs',                     COUNT(*)              FROM audit_logs
) t
ORDER BY tabela;

-- ── 2. Integridade referencial ────────────────────────────────────────
\echo ''
\echo '[2] Verificação de integridade referencial'
\echo '--------------------------------------------'

SELECT
  'obras sem empresa'          AS problema,
  COUNT(*) AS qtd
FROM obras o
WHERE NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = o.empresa_id)

UNION ALL

SELECT
  'contratos sem obra',
  COUNT(*)
FROM contratos c
WHERE NOT EXISTS (SELECT 1 FROM obras o WHERE o.id = c.obra_id)

UNION ALL

SELECT
  'contratos sem fornecedor',
  COUNT(*)
FROM contratos c
WHERE NOT EXISTS (SELECT 1 FROM fornecedores f WHERE f.id = c.fornecedor_id)

UNION ALL

SELECT
  'medicoes sem contrato',
  COUNT(*)
FROM medicoes m
WHERE NOT EXISTS (SELECT 1 FROM contratos c WHERE c.id = m.contrato_id)

UNION ALL

SELECT
  'medicao_itens sem medicao',
  COUNT(*)
FROM medicao_itens mi
WHERE NOT EXISTS (SELECT 1 FROM medicoes m WHERE m.id = mi.medicao_id)

UNION ALL

SELECT
  'aprovacoes sem medicao',
  COUNT(*)
FROM aprovacoes a
WHERE NOT EXISTS (SELECT 1 FROM medicoes m WHERE m.id = a.medicao_id)

UNION ALL

SELECT
  'portal_nfs sem medicao',
  COUNT(*)
FROM portal_nfs pn
WHERE NOT EXISTS (SELECT 1 FROM medicoes m WHERE m.id = pn.medicao_id);

-- ── 3. Sequences (devem ser >= MAX(id)) ──────────────────────────────
\echo ''
\echo '[3] Verificação de sequences'
\echo '--------------------------------------------'

SELECT
  seq_name,
  seq_val,
  max_id,
  CASE WHEN seq_val >= max_id THEN '✅ OK' ELSE '❌ PROBLEMA — sequence menor que MAX(id)!' END AS situacao
FROM (
  SELECT 'empresas'             AS seq_name, nextval('empresas_id_seq')              - 1 AS seq_val, COALESCE(MAX(id),0) AS max_id FROM empresas              UNION ALL
  SELECT 'fornecedores',        nextval('fornecedores_id_seq')          - 1,            COALESCE(MAX(id),0) FROM fornecedores      UNION ALL
  SELECT 'obras',               nextval('obras_id_seq')                 - 1,            COALESCE(MAX(id),0) FROM obras             UNION ALL
  SELECT 'contratos',           nextval('contratos_id_seq')             - 1,            COALESCE(MAX(id),0) FROM contratos         UNION ALL
  SELECT 'medicoes',            nextval('medicoes_id_seq')              - 1,            COALESCE(MAX(id),0) FROM medicoes          UNION ALL
  SELECT 'usuarios',            nextval('usuarios_id_seq')              - 1,            COALESCE(MAX(id),0) FROM usuarios          UNION ALL
  SELECT 'portal_nfs',          nextval('portal_nfs_id_seq')            - 1,            COALESCE(MAX(id),0) FROM portal_nfs
) t;

-- Corrige sequences que estejam abaixo do necessário
SELECT setval('empresas_id_seq',              GREATEST(nextval('empresas_id_seq'),              (SELECT COALESCE(MAX(id),1) FROM empresas)));
SELECT setval('fornecedores_id_seq',          GREATEST(nextval('fornecedores_id_seq'),          (SELECT COALESCE(MAX(id),1) FROM fornecedores)));
SELECT setval('obras_id_seq',                 GREATEST(nextval('obras_id_seq'),                 (SELECT COALESCE(MAX(id),1) FROM obras)));
SELECT setval('contratos_id_seq',             GREATEST(nextval('contratos_id_seq'),             (SELECT COALESCE(MAX(id),1) FROM contratos)));
SELECT setval('contrato_itens_id_seq',        GREATEST(nextval('contrato_itens_id_seq'),        (SELECT COALESCE(MAX(id),1) FROM contrato_itens)));
SELECT setval('medicoes_id_seq',              GREATEST(nextval('medicoes_id_seq'),              (SELECT COALESCE(MAX(id),1) FROM medicoes)));
SELECT setval('medicao_itens_id_seq',         GREATEST(nextval('medicao_itens_id_seq'),         (SELECT COALESCE(MAX(id),1) FROM medicao_itens)));
SELECT setval('evidencias_id_seq',            GREATEST(nextval('evidencias_id_seq'),            (SELECT COALESCE(MAX(id),1) FROM evidencias)));
SELECT setval('aprovacoes_id_seq',            GREATEST(nextval('aprovacoes_id_seq'),            (SELECT COALESCE(MAX(id),1) FROM aprovacoes)));
SELECT setval('alcadas_id_seq',               GREATEST(nextval('alcadas_id_seq'),               (SELECT COALESCE(MAX(id),1) FROM alcadas)));
SELECT setval('usuarios_id_seq',              GREATEST(nextval('usuarios_id_seq'),              (SELECT COALESCE(MAX(id),1) FROM usuarios)));
SELECT setval('cronogramas_id_seq',           GREATEST(nextval('cronogramas_id_seq'),           (SELECT COALESCE(MAX(id),1) FROM cronogramas)));
SELECT setval('atividades_cronograma_id_seq', GREATEST(nextval('atividades_cronograma_id_seq'), (SELECT COALESCE(MAX(id),1) FROM atividades_cronograma)));
SELECT setval('portal_tokens_id_seq',         GREATEST(nextval('portal_tokens_id_seq'),         (SELECT COALESCE(MAX(id),1) FROM portal_tokens)));
SELECT setval('portal_nfs_id_seq',            GREATEST(nextval('portal_nfs_id_seq'),            (SELECT COALESCE(MAX(id),1) FROM portal_nfs)));
SELECT setval('lbm_locais_id_seq',            GREATEST(nextval('lbm_locais_id_seq'),            (SELECT COALESCE(MAX(id),1) FROM lbm_locais)));
SELECT setval('lbm_servicos_id_seq',          GREATEST(nextval('lbm_servicos_id_seq'),          (SELECT COALESCE(MAX(id),1) FROM lbm_servicos)));
SELECT setval('lbm_progresso_id_seq',         GREATEST(nextval('lbm_progresso_id_seq'),         (SELECT COALESCE(MAX(id),1) FROM lbm_progresso)));
SELECT setval('audit_logs_id_seq',            GREATEST(nextval('audit_logs_id_seq'),            (SELECT COALESCE(MAX(id),1) FROM audit_logs)));

-- ── 4. Usuário admin ──────────────────────────────────────────────────
\echo ''
\echo '[4] Usuários com perfil ADM'
\echo '--------------------------------------------'

SELECT id, login, nome, email, perfil, ativo, ultimo_acesso
FROM usuarios
WHERE perfil = 'ADM'
ORDER BY id;

-- ── 5. Medições por status ────────────────────────────────────────────
\echo ''
\echo '[5] Medições por status'
\echo '--------------------------------------------'

SELECT
  status,
  COUNT(*) AS quantidade,
  SUM(valor_medicao) AS valor_total
FROM medicoes
GROUP BY status
ORDER BY
  CASE status
    WHEN 'Rascunho'      THEN 1
    WHEN 'Aguardando N1' THEN 2
    WHEN 'Aguardando N2' THEN 3
    WHEN 'Aguardando N3' THEN 4
    WHEN 'Aprovado'      THEN 5
    WHEN 'Em Assinatura' THEN 6
    WHEN 'Assinado'      THEN 7
    WHEN 'Pago'          THEN 8
    WHEN 'Concluído'     THEN 9
    WHEN 'Reprovado'     THEN 10
  END;

\echo ''
\echo '============================================'
\echo ' Validação concluída!'
\echo ' Verifique os resultados acima.'
\echo ' Qtd = 0 em problema = tudo OK.'
\echo '============================================'
