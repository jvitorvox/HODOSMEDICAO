/**
 * CONSTRUTIVO OBRAS — Helpers de Inteligência Artificial
 * Gemini 2.5 Flash: conversão de arquivos, chamada à API e normalização de datas.
 */
const multer = require('multer');
const db     = require('../db');

// ── Multer em memória (somente para rotas de IA; não grava em disco) ──
const MIME_ACEITOS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  // Excel
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  // CSV / texto
  'text/csv',
  'text/plain',
  'application/csv',
];
const EXT_ACEITAS = /\.(pdf|docx|doc|xlsx|xls|csv|txt)$/i;

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const ok = MIME_ACEITOS.includes(file.mimetype) || EXT_ACEITAS.test(file.originalname);
    cb(ok ? null : new Error('Formato inválido. Use PDF, DOCX, XLSX, XLS ou CSV.'), ok);
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
 * PDF  → inline_data base64
 * DOCX → texto via mammoth
 * XLSX/XLS → texto via SheetJS (cada aba como tabela CSV)
 * CSV/TXT → texto puro
 */
async function _iaFileToParts(file) {
  const nome = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  // PDF — envia direto como inline_data
  if (mime === 'application/pdf' || nome.endsWith('.pdf')) {
    return [{ inline_data: { mime_type: 'application/pdf', data: file.buffer.toString('base64') } }];
  }

  // Excel (.xlsx / .xls) — converte para texto, com truncamento inteligente em abas grandes
  if (
    mime.includes('spreadsheet') || mime.includes('excel') ||
    nome.endsWith('.xlsx') || nome.endsWith('.xls')
  ) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });

    // Limite de tamanho do texto total enviado ao Gemini (~180 KB de texto é seguro)
    const MAX_CHARS_TOTAL  = 180_000;
    // Abas "pequenas" são convertidas integralmente
    const SMALL_MAX_ROWS   = 300;
    const SMALL_MAX_COLS   = 60;
    // Para abas grandes: cabeçalho completo + colunas de rótulo de linha
    const MAX_HEADER_ROWS  = 15;   // primeiras N linhas completas (cabeçalhos/datas)
    const MAX_HEADER_COLS  = 60;   // primeiras N colunas do cabeçalho
    const MAX_LABEL_COLS   = 6;    // primeiras N colunas de cada linha (rótulos de locais/serviços)
    const MAX_LABEL_ROWS   = 600;  // quantas linhas de rótulo enviar após o cabeçalho

    const partes = [];
    let totalChars = 0;

    for (const sheetName of wb.SheetNames) {
      if (totalChars >= MAX_CHARS_TOTAL) break;

      const ws = wb.Sheets[sheetName];
      const ref = ws['!ref'];
      if (!ref) continue;

      const range = XLSX.utils.decode_range(ref);
      const nRows = range.e.r - range.s.r + 1;
      const nCols = range.e.c - range.s.c + 1;

      let textoAba;

      if (nRows <= SMALL_MAX_ROWS && nCols <= SMALL_MAX_COLS) {
        // Aba pequena — converte tudo normalmente
        const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
        textoAba = `=== ABA: ${sheetName} ===\n${csv}`;
      } else {
        // Aba grande — extrai estrutura de forma inteligente:
        // 1. Primeiras MAX_HEADER_ROWS linhas completas (cabeçalhos / hierarquia de colunas)
        // 2. Primeiras MAX_LABEL_COLS colunas de todas as linhas restantes
        //    (captura rótulos de locais em colunas B/C/D ou rótulos de serviços)

        const linhas = [];

        // Parte 1: cabeçalho completo
        const rowsFull = Math.min(MAX_HEADER_ROWS, nRows);
        const colsFull = Math.min(MAX_HEADER_COLS, nCols);
        for (let r = range.s.r; r < range.s.r + rowsFull; r++) {
          const celulas = [];
          for (let c = range.s.c; c < range.s.c + colsFull; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ws[addr];
            celulas.push(cell ? String(cell.v ?? '').trim() : '');
          }
          if (celulas.some(v => v)) linhas.push(celulas.join('\t'));
        }
        if (nCols > colsFull) {
          linhas.push(`[... ${nCols - colsFull} colunas de datas/valores omitidas ...]`);
        }

        // Parte 2: rótulos das linhas restantes (primeiras MAX_LABEL_COLS colunas)
        const labelRows = Math.min(MAX_LABEL_ROWS, nRows - rowsFull);
        const labelColsFull = Math.min(MAX_LABEL_COLS, nCols);
        const labelLinhas = [];
        for (let r = range.s.r + rowsFull; r < range.s.r + rowsFull + labelRows; r++) {
          const celulas = [];
          for (let c = range.s.c; c < range.s.c + labelColsFull; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ws[addr];
            celulas.push(cell ? String(cell.v ?? '').trim() : '');
          }
          if (celulas.some(v => v)) labelLinhas.push(celulas.join('\t'));
        }
        if (labelLinhas.length) {
          linhas.push(`\n[Rótulos das demais linhas — primeiras ${labelColsFull} colunas]`);
          linhas.push(...labelLinhas);
        }

        const nota = `[NOTA: Planilha grande (${nRows} linhas × ${nCols} colunas). ` +
          `Exibidas: primeiras ${rowsFull} linhas completas (${colsFull} colunas) + ` +
          `primeiras ${labelColsFull} colunas das próximas ${labelRows} linhas.]`;

        textoAba = `=== ABA: ${sheetName} ===\n${nota}\n${linhas.join('\n')}`;
      }

      if (textoAba.trim()) {
        partes.push(textoAba);
        totalChars += textoAba.length;
      }
    }

    if (!partes.length) throw new Error('Planilha vazia ou sem dados legíveis.');
    return [{ text: `CONTEÚDO DA PLANILHA EXCEL:\n\n${partes.join('\n\n')}` }];
  }

  // CSV / TXT — texto puro
  if (mime.includes('csv') || mime.includes('text') || nome.endsWith('.csv') || nome.endsWith('.txt')) {
    const texto = file.buffer.toString('utf8');
    if (!texto.trim()) throw new Error('Arquivo CSV vazio.');
    return [{ text: `CONTEÚDO DO CSV:\n\n${texto}` }];
  }

  // DOCX / DOC
  const mammoth   = require('mammoth');
  const extracted = await mammoth.extractRawText({ buffer: file.buffer });
  const texto     = extracted.value?.trim();
  if (!texto) throw new Error('Não foi possível extrair texto do DOCX.');
  return [{ text: `CONTEÚDO DO DOCUMENTO:\n\n${texto}` }];
}

/**
 * Chama o modelo Gemini 2.5 Flash e retorna o texto bruto da resposta,
 * removendo eventuais delimitadores de bloco de código markdown.
 * @param {string} apiKey
 * @param {Array}  parts
 * @param {object} [opts]
 * @param {number} [opts.maxOutputTokens=16384]  — tokens de saída (default maior para LBM)
 * @param {number} [opts.thinkingBudget]         — orçamento de thinking (0 = desliga; omitir = padrão do modelo)
 */
async function _iaCall(apiKey, parts, opts = {}) {
  const maxOutputTokens = opts.maxOutputTokens ?? 16384;

  // Monta generationConfig — só inclui thinkingConfig se explicitamente solicitado
  const generationConfig = { temperature: 0.1, maxOutputTokens };
  if (typeof opts.thinkingBudget === 'number') {
    generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    }
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`Erro na API Gemini: ${err?.error?.message || `HTTP ${r.status}`}`);
  }
  const data = await r.json();

  // Detecta truncamento pelo finishReason
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    console.warn(`[IA] finishReason=${finishReason} — resposta pode estar incompleta`);
  }

  // Agrega todos os parts de texto (exclui thinking parts se houver)
  const allParts = data?.candidates?.[0]?.content?.parts || [];
  const textParts = allParts.filter(p => p.text && !p.thought);
  const raw = (textParts.length ? textParts : allParts).map(p => p.text || '').join('').trim();

  if (!raw) {
    const candidate = data?.candidates?.[0];
    console.error('[IA] Resposta vazia. finishReason:', finishReason, '| candidate:', JSON.stringify(candidate)?.slice(0, 500));
    throw new Error(`Gemini retornou resposta vazia (finishReason: ${finishReason || 'desconhecido'}). Tente um arquivo menor ou mais simples.`);
  }

  // 1. Remove blocos de markdown (```json ... ```) em qualquer variação
  let cleaned = raw.replace(/^```[\w]*\r?\n?/i, '').replace(/\r?\n?```[\w]*\s*$/i, '').trim();
  // 2. Se não começa com { ou [, tenta extrair o primeiro objeto/array JSON
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) cleaned = m[0];
  }
  // 3. Se JSON está truncado (finishReason=MAX_TOKENS), avisa com mensagem clara
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('O arquivo gerou uma resposta muito longa para o Gemini. Tente importar um arquivo mais resumido, com menos abas ou colunas.');
  }
  return cleaned;
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

module.exports = { uploadMem, _iaGetKey, _iaFileToParts, _iaCall, _parseDate, EXT_ACEITAS, MIME_ACEITOS };
