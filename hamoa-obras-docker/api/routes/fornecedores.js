/**
 * CONSTRUTIVO OBRAS — Rotas de Fornecedores
 * GET    /api/fornecedores
 * POST   /api/fornecedores
 * PUT    /api/fornecedores/:id
 * DELETE /api/fornecedores/:id
 * POST   /api/fornecedores/interpretar  (IA: extrai dados cadastrais do documento)
 */
const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const { perm } = require('../middleware/perm');
const audit   = require('../middleware/audit');
const { uploadMem, _iaGetKey, _iaFileToParts, _iaCall } = require('../helpers/ia');

// ── CRUD ────────────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM fornecedores WHERE ativo=true ORDER BY razao_social');
  res.json(r.rows);
});

router.post('/', auth, perm('cadastros'), async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin,
          endereco, representante, cargo_representante,
          cpf_representante, data_nasc_representante } = req.body;
  const r = await db.query(
    `INSERT INTO fornecedores
       (razao_social,nome_fantasia,cnpj,tel,email,email_nf,email_assin,endereco,
        representante,cargo_representante,cpf_representante,data_nasc_representante)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin,
     endereco||null, representante||null, cargo_representante||null,
     cpf_representante||null, data_nasc_representante||null]
  );
  const row = r.rows[0];
  await audit(req, 'criar', 'fornecedor', row.id, `Fornecedor "${row.razao_social}" criado`);
  res.status(201).json(row);
});

router.put('/:id', auth, perm('cadastros'), async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin,
          endereco, representante, cargo_representante, ativo,
          cpf_representante, data_nasc_representante } = req.body;
  const r = await db.query(
    `UPDATE fornecedores SET
       razao_social=$1,nome_fantasia=$2,cnpj=$3,tel=$4,email=$5,
       email_nf=$6,email_assin=$7,endereco=$8,representante=$9,cargo_representante=$10,ativo=$11,
       cpf_representante=$12,data_nasc_representante=$13
     WHERE id=$14 RETURNING *`,
    [razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin,
     endereco||null, representante||null, cargo_representante||null, ativo,
     cpf_representante||null, data_nasc_representante||null, req.params.id]
  );
  const row = r.rows[0];
  const status = row.ativo ? 'ativo' : 'inativo';
  await audit(req, 'editar', 'fornecedor', row.id, `Fornecedor "${row.razao_social}" atualizado — ${status}`);
  res.json(row);
});

router.delete('/:id', auth, perm('cadastros'), async (req, res) => {
  const prev = await db.query('SELECT razao_social FROM fornecedores WHERE id=$1', [req.params.id]);
  await db.query('UPDATE fornecedores SET ativo=false WHERE id=$1', [req.params.id]);
  await audit(req, 'excluir', 'fornecedor', parseInt(req.params.id), `Fornecedor "${prev.rows[0]?.razao_social || req.params.id}" desativado`);
  res.status(204).end();
});

// ── Importação em massa (CSV) ────────────────────────────────────
router.post('/bulk', auth, perm('cadastros'), async (req, res) => {
  const registros = req.body;
  if (!Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ error: 'Envie um array de registros.' });

  const resultados = [];
  for (let i = 0; i < registros.length; i++) {
    const { razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin,
            endereco, representante, cargo_representante, cpf_representante } = registros[i];
    const linha = i + 2;
    if (!razao_social || !cnpj) {
      resultados.push({ linha, status: 'erro', motivo: 'razao_social e cnpj são obrigatórios' });
      continue;
    }
    try {
      const r = await db.query(
        `INSERT INTO fornecedores
           (razao_social,nome_fantasia,cnpj,tel,email,email_nf,email_assin,
            endereco,representante,cargo_representante,cpf_representante)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [razao_social.trim(), nome_fantasia?.trim()||null, cnpj.trim(),
         tel?.trim()||null, email?.trim()||null, email_nf?.trim()||null,
         email_assin?.trim()||null, endereco?.trim()||null,
         representante?.trim()||null, cargo_representante?.trim()||null,
         cpf_representante?.trim()||null]
      );
      await audit(req, 'criar', 'fornecedor', r.rows[0].id, `Fornecedor "${razao_social}" importado em massa`);
      resultados.push({ linha, status: 'ok', id: r.rows[0].id, razao_social });
    } catch (e) {
      resultados.push({ linha, status: 'erro', motivo: e.detail || e.message, razao_social });
    }
  }
  const ok = resultados.filter(r => r.status === 'ok').length;
  const erros = resultados.filter(r => r.status === 'erro').length;
  res.json({ total: registros.length, importados: ok, erros, resultados });
});

// ── IA: interpretação de documento ──────────────────────────────

router.post('/interpretar', auth, uploadMem.single('arquivo'), async (req, res) => {
  try {
    const apiKey = await _iaGetKey();
    if (!apiKey) return res.status(503).json({
      error: 'Chave da API Gemini não configurada.',
      dica: 'Acesse Configurações → Inteligência Artificial e informe sua chave gratuita de https://aistudio.google.com/app/apikey',
    });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const parts = await _iaFileToParts(req.file);
    parts.push({
      text: `Você é um especialista em análise de documentos empresariais e contratos.
Analise o documento acima e extraia os dados cadastrais do FORNECEDOR/CONTRATADO (empresa que presta o serviço ou fornece os materiais).

Retorne SOMENTE um objeto JSON válido (sem markdown, sem explicações extras) com o seguinte formato:
{
  "razao_social": "Razão Social completa da empresa conforme CNPJ",
  "nome_fantasia": "Nome fantasia ou nome comercial (se houver, senão null)",
  "cnpj": "CNPJ no formato 00.000.000/0001-00",
  "tel": "Telefone principal com DDD no formato (00) 00000-0000 (se houver, senão null)",
  "email": "E-mail de contato geral da empresa (se houver, senão null)",
  "email_nf": "E-mail específico para envio de Nota Fiscal (se houver, use o mesmo de contato, senão null)",
  "email_assin": "E-mail para assinatura eletrônica de documentos, pode ser do representante legal (se houver, senão null)",
  "representante": "Nome do representante legal ou responsável pela assinatura (se houver, senão null)",
  "cargo_representante": "Cargo do representante legal (ex: Sócio-Administrador, Diretor, etc.) (se houver, senão null)",
  "cep": "CEP da empresa (se houver, senão null)",
  "endereco": "Endereço completo (logradouro, número, complemento, bairro, cidade, UF) (se houver, senão null)"
}

Regras importantes:
- Busque informações do FORNECEDOR/CONTRATADO, NÃO do contratante/tomador de serviços.
- CNPJ: retorne no formato com pontos e traço: 00.000.000/0001-00.
- Telefone: inclua o DDD, formate como (00) 00000-0000 ou (00) 0000-0000.
- Se um campo não for encontrado no documento, retorne null para ele.
- Não invente ou assuma informações que não estejam explicitamente no documento.`,
    });

    const cleaned = await _iaCall(apiKey, parts);
    let dados;
    try {
      dados = JSON.parse(cleaned);
      if (typeof dados !== 'object' || Array.isArray(dados)) dados = {};
    } catch {
      return res.status(422).json({
        error: 'Formato inesperado retornado pelo modelo. Tente novamente.',
        raw: cleaned.slice(0, 800),
      });
    }

    const str = (v, max = 200) => (v && typeof v === 'string') ? v.trim().slice(0, max) : null;
    res.json({
      dados: {
        razao_social:        str(dados.razao_social, 300),
        nome_fantasia:       str(dados.nome_fantasia, 200),
        cnpj:                str(dados.cnpj, 20),
        tel:                 str(dados.tel, 20),
        email:               str(dados.email, 200),
        email_nf:            str(dados.email_nf, 200),
        email_assin:         str(dados.email_assin, 200),
        representante:       str(dados.representante, 200),
        cargo_representante: str(dados.cargo_representante, 100),
        cep:                 str(dados.cep, 10),
        endereco:            str(dados.endereco, 500),
      },
      modelo: 'gemini-2.5-flash',
    });
  } catch (e) {
    console.error('[IA/fornecedor]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
