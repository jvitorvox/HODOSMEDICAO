/**
 * HAMOA OBRAS — Rota do Dashboard
 * GET /api/dashboard
 * Retorna estatísticas gerais, carteira de contratos e progresso por contrato.
 * Apenas contratos com ao menos uma medição lançada aparecem no painel.
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const periodo = new Date().toISOString().slice(0, 7);

  const [doMes, aguardando, aprovadas, assinatura, valorMes, totaisContratos, progressoContratos] =
    await Promise.all([
      db.query('SELECT COUNT(*) FROM medicoes WHERE periodo=$1', [periodo]),
      db.query("SELECT COUNT(*) FROM medicoes WHERE status IN ('Aguardando N1','Aguardando N2','Aguardando N3')"),
      db.query("SELECT COUNT(*) FROM medicoes WHERE status='Aprovado'"),
      db.query("SELECT COUNT(*) FROM medicoes WHERE status='Em Assinatura'"),
      db.query('SELECT COALESCE(SUM(valor_medicao),0) AS total FROM medicoes WHERE periodo=$1', [periodo]),

      // Totalizador — apenas contratos com ao menos uma medição lançada
      db.query(`
        SELECT
          COUNT(c.id)                         AS total_contratos,
          COALESCE(SUM(c.valor_total), 0)     AS valor_total_carteira,
          COALESCE(SUM(ex.valor_executado),0) AS valor_executado_carteira
        FROM contratos c
        LEFT JOIN (
          SELECT m.contrato_id, SUM(mi.valor_item) AS valor_executado
          FROM medicao_itens mi
          JOIN medicoes m ON m.id = mi.medicao_id
          WHERE m.status NOT IN ('Rascunho','Reprovado')
          GROUP BY m.contrato_id
        ) ex ON ex.contrato_id = c.id
        WHERE c.status = 'Vigente'
          AND EXISTS (SELECT 1 FROM medicoes WHERE contrato_id = c.id)
      `),

      // Progresso por contrato (até 20, do mais avançado ao menos)
      db.query(`
        SELECT
          c.id, c.numero, c.objeto, c.valor_total,
          o.nome AS obra_nome,
          COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor_nome,
          COALESCE(ex.valor_executado, 0)::NUMERIC(15,2) AS valor_executado,
          CASE WHEN c.valor_total > 0
               THEN LEAST(100, ROUND(COALESCE(ex.valor_executado,0) / c.valor_total * 100, 2))
               ELSE 0 END AS pct_executado
        FROM contratos c
        JOIN obras        o ON o.id = c.obra_id
        JOIN fornecedores f ON f.id = c.fornecedor_id
        LEFT JOIN (
          SELECT m.contrato_id, SUM(mi.valor_item) AS valor_executado
          FROM medicao_itens mi
          JOIN medicoes m ON m.id = mi.medicao_id
          WHERE m.status NOT IN ('Rascunho','Reprovado')
          GROUP BY m.contrato_id
        ) ex ON ex.contrato_id = c.id
        WHERE c.status = 'Vigente'
          AND EXISTS (SELECT 1 FROM medicoes WHERE contrato_id = c.id)
        ORDER BY pct_executado DESC, c.valor_total DESC
        LIMIT 20
      `),
    ]);

  const t           = totaisContratos.rows[0];
  const valTotCart  = parseFloat(t.valor_total_carteira)   || 0;
  const valExecCart = parseFloat(t.valor_executado_carteira) || 0;
  const pctCarteira = valTotCart > 0
    ? parseFloat(Math.min(100, (valExecCart / valTotCart * 100)).toFixed(2))
    : 0;

  res.json({
    doMes:      parseInt(doMes.rows[0].count),
    aguardando: parseInt(aguardando.rows[0].count),
    aprovadas:  parseInt(aprovadas.rows[0].count),
    assinatura: parseInt(assinatura.rows[0].count),
    valorMes:   parseFloat(valorMes.rows[0].total),
    // Carteira
    totalContratos:         parseInt(t.total_contratos) || 0,
    valorTotalCarteira:     valTotCart,
    valorExecutadoCarteira: valExecCart,
    pctCarteira,
    // Progresso individual
    progressoContratos: progressoContratos.rows.map(c => ({
      id:              c.id,
      numero:          c.numero,
      objeto:          c.objeto,
      obra_nome:       c.obra_nome,
      fornecedor_nome: c.fornecedor_nome,
      valor_total:     parseFloat(c.valor_total)     || 0,
      valor_executado: parseFloat(c.valor_executado) || 0,
      pct_executado:   parseFloat(c.pct_executado)   || 0,
    })),
  });
});

module.exports = router;
