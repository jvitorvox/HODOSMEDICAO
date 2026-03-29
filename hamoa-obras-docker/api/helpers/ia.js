/**
 * HAMOA OBRAS — Helpers de Inteligência Artificial
 * Gemini 2.5 Flash: conversão de arquivos, chamada à API e normalização de datas.
 */
const multer = require('multer');
const db     = require('../db');

// ── Multer em memória (somente para rotas de IA; não grava em disco) ──
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ].includes(file.mimetype) || /\.(pdf|docx|doc)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato inválido. Use PDF ou DOCX.'), ok);
  },
});

/**
 * Resolve a chave Gemini: variável de ambiente tem prioridade,
 * depois lê da tabela `configuracoes` no banco.
 */
async function _iaGetKey() {
  let apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    const cfgRow = await db.query("SELECT valor FROM configuracoes WHERE chave='ia'");
    apiKey = cfgRow.rows[0]?.valor?.gemini_api_key || '';
  }
  return apiKey;
}

/**
 * Converte um arquivo (Buffer) em parts[] compatíveis com a API Gemini.
 * PDF → inline_data base64 | DOCX → texto extraído via mammoth.
 */
async function _iaFileToParts(file) {
  const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
  if (isPdf) {
    return [{ inline_data: { mime_type: 'application/pdf', data: file.buffer.toString('base64') } }];
  }
  const mammoth  = require('mammoth');
  const extracted = await mammoth.extractRawText({ buffer: file.buffer });
  const texto     = extracted.value?.trim();
  if (!texto) throw new Error('Não foi possível extrair texto do DOCX.');
  return [{ text: `CONTEÚDO DO DOCUMENTO:\n\n${texto}` }];
}

/**
 * Chama o modelo Gemini 2.5 Flash e retorna o texto bruto da resposta,
 * removendo eventuais delimitadores de bloco de código markdown.
 */
async function _iaCall(apiKey, parts) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    }
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`Erro na API Gemini: ${err?.error?.message || `HTTP ${r.status}`}`);
  }
  const data = await r.json();
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
}

/**
 * Normaliza datas para o formato YYYY-MM-DD, independente do formato de origem.
 * Suporta: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, datas por extenso em PT-BR.
 * @param {string|null} raw
 * @returns {string|null}
 */
function _parseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();

  // Já está em YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;

  // MM/DD/YYYY (americano) — só quando dia > 12 e mês <= 12
  const mdy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (mdy && parseInt(mdy[1]) <= 12 && parseInt(mdy[2]) > 12)
    return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;

  // Por extenso: "01 de janeiro de 2024" ou "janeiro de 2024"
  const meses = {
    janeiro:1, fevereiro:2, março:3, marco:3, abril:4, maio:5, junho:6,
    julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12,
  };
  const ext = s.toLowerCase().match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (ext && meses[ext[2]])
    return `${ext[3]}-${String(meses[ext[2]]).padStart(2,'0')}-${ext[1].padStart(2,'0')}`;
  const extMY = s.toLowerCase().match(/(\w+)\s+de\s+(\d{4})/);
  if (extMY && meses[extMY[1]])
    return `${extMY[2]}-${String(meses[extMY[1]]).padStart(2,'0')}-01`;

  // Tentativa genérica via Date.parse
  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return null;
}

module.exports = { uploadMem, _iaGetKey, _iaFileToParts, _iaCall, _parseDate };
