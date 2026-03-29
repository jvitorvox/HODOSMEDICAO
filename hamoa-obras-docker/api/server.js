/**
 * HAMOA OBRAS — API Backend (Express + PostgreSQL)
 * Servidor principal
 */
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');
const morgan     = require('morgan');
const { Pool }   = require('pg');
const redis      = require('redis');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcrypt');
const multer     = require('multer');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// Necessário para express-rate-limit funcionar corretamente atrás do Nginx
app.set('trust proxy', 1);

// ── PostgreSQL ──────────────────────────────────────────────────
const db = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'hamoa_obras',
  user:     process.env.DB_USER || 'hamoa',
  password: process.env.DB_PASS || 'hamoa@2025',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

db.on('error', (err) => console.error('DB pool error:', err));

// ── Redis ───────────────────────────────────────────────────────
const redisClient = redis.createClient({
  url: `redis://:${process.env.REDIS_PASS||'hamoa-redis@2025'}@${process.env.REDIS_HOST||'hamoa-redis'}:6379`
});
redisClient.connect().catch(console.error);

// ── Middleware global ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Muitas tentativas. Aguarde.' } }));
app.use('/api/', rateLimit({ windowMs: 60*1000, max: 300 }));

// ── Upload de arquivos ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads'),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Auth middleware ─────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch(e) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

// ═══════════════════════════════════════════════════════════════
// ROTAS
// ═══════════════════════════════════════════════════════════════

// ── Health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'hamoa-obras-api', version: '3.0.0', ts: new Date() });
});

// ── Auth ────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, senha } = req.body;
    if(!login || !senha) return res.status(400).json({ error: 'Login e senha obrigatórios' });

    // Tenta LDAP primeiro se configurado
    const ldapCfg = await db.query("SELECT valor FROM configuracoes WHERE chave='ldap'");
    const ldap = ldapCfg.rows[0] ? ldapCfg.rows[0].valor : {};

    let user;
    if(ldap.ativo) {
      // Autenticação LDAP (implementar com ldapjs)
      // user = await ldapAuth(login, senha, ldap);
      return res.status(503).json({ error: 'LDAP auth: implemente a integração com seu AD' });
    } else {
      // Autenticação local
      const r = await db.query('SELECT * FROM usuarios WHERE login=$1 AND ativo=true', [login]);
      if(!r.rows[0]) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
      const ok = await bcrypt.compare(senha, r.rows[0].senha_hash);
      if(!ok) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
      user = r.rows[0];
    }

    await db.query('UPDATE usuarios SET ultimo_acesso=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign(
      { id: user.id, login: user.login, nome: user.nome, perfil: user.perfil, grupos: user.grupos_ad },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    res.json({ token, user: { id: user.id, login: user.login, nome: user.nome, perfil: user.perfil } });
  } catch(e) {
    console.error(e); res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Empresas ────────────────────────────────────────────────────
app.get('/api/empresas', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM empresas ORDER BY razao_social');
  res.json(r.rows);
});
app.post('/api/empresas', auth, async (req, res) => {
  const { razao_social, nome_fantasia, cnpj } = req.body;
  const r = await db.query('INSERT INTO empresas(razao_social,nome_fantasia,cnpj) VALUES($1,$2,$3) RETURNING *', [razao_social,nome_fantasia,cnpj]);
  res.status(201).json(r.rows[0]);
});
app.put('/api/empresas/:id', auth, async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, ativo } = req.body;
  const r = await db.query('UPDATE empresas SET razao_social=$1,nome_fantasia=$2,cnpj=$3,ativo=$4 WHERE id=$5 RETURNING *',[razao_social,nome_fantasia,cnpj,ativo,req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/empresas/:id', auth, async (req, res) => {
  await db.query('DELETE FROM empresas WHERE id=$1',[req.params.id]); res.status(204).end();
});

// ── Obras ───────────────────────────────────────────────────────
app.get('/api/obras', auth, async (req, res) => {
  const q = req.query.empresa_id
    ? 'SELECT o.*,e.nome_fantasia as empresa_nome FROM obras o JOIN empresas e ON o.empresa_id=e.id WHERE o.empresa_id=$1 ORDER BY o.nome'
    : 'SELECT o.*,e.nome_fantasia as empresa_nome FROM obras o JOIN empresas e ON o.empresa_id=e.id ORDER BY o.nome';
  const r = await db.query(q, req.query.empresa_id ? [req.query.empresa_id] : []);
  res.json(r.rows);
});
app.post('/api/obras', auth, async (req, res) => {
  const { empresa_id, codigo, nome, localizacao, gestor, status } = req.body;
  const r = await db.query('INSERT INTO obras(empresa_id,codigo,nome,localizacao,gestor,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[empresa_id,codigo,nome,localizacao,gestor,status||'Em andamento']);
  res.status(201).json(r.rows[0]);
});
app.put('/api/obras/:id', auth, async (req, res) => {
  const { empresa_id, codigo, nome, localizacao, gestor, status } = req.body;
  const r = await db.query('UPDATE obras SET empresa_id=$1,codigo=$2,nome=$3,localizacao=$4,gestor=$5,status=$6 WHERE id=$7 RETURNING *',[empresa_id,codigo,nome,localizacao,gestor,status,req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/obras/:id', auth, async (req, res) => {
  await db.query('DELETE FROM obras WHERE id=$1',[req.params.id]); res.status(204).end();
});

// ── Fornecedores ────────────────────────────────────────────────
app.get('/api/fornecedores', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM fornecedores WHERE ativo=true ORDER BY razao_social');
  res.json(r.rows);
});
app.post('/api/fornecedores', auth, async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin } = req.body;
  const r = await db.query('INSERT INTO fornecedores(razao_social,nome_fantasia,cnpj,tel,email,email_nf,email_assin) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[razao_social,nome_fantasia,cnpj,tel,email,email_nf,email_assin]);
  res.status(201).json(r.rows[0]);
});
app.put('/api/fornecedores/:id', auth, async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin, ativo } = req.body;
  const r = await db.query('UPDATE fornecedores SET razao_social=$1,nome_fantasia=$2,cnpj=$3,tel=$4,email=$5,email_nf=$6,email_assin=$7,ativo=$8 WHERE id=$9 RETURNING *',[razao_social,nome_fantasia,cnpj,tel,email,email_nf,email_assin,ativo,req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/fornecedores/:id', auth, async (req, res) => {
  await db.query('UPDATE fornecedores SET ativo=false WHERE id=$1',[req.params.id]); res.status(204).end();
});

// ── Contratos ───────────────────────────────────────────────────
app.get('/api/contratos', auth, async (req, res) => {
  let q = `SELECT c.*,o.nome as obra_nome,f.nome_fantasia as fornecedor_nome,e.nome_fantasia as empresa_nome
           FROM contratos c JOIN obras o ON c.obra_id=o.id JOIN fornecedores f ON c.fornecedor_id=f.id JOIN empresas e ON c.empresa_id=e.id`;
  const params = [];
  if(req.query.obra_id) { q += ' WHERE c.obra_id=$1'; params.push(req.query.obra_id); }
  q += ' ORDER BY c.numero';
  res.json((await db.query(q, params)).rows);
});
app.post('/api/contratos', auth, async (req, res) => {
  const { empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,inicio,termino,status,obs } = req.body;
  const r = await db.query('INSERT INTO contratos(empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,inicio,termino,status,obs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,inicio,termino,status||'Vigente',obs]);
  res.status(201).json(r.rows[0]);
});
app.put('/api/contratos/:id', auth, async (req, res) => {
  const { empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,pct_executado,inicio,termino,status,obs } = req.body;
  const r = await db.query('UPDATE contratos SET empresa_id=$1,obra_id=$2,fornecedor_id=$3,numero=$4,objeto=$5,valor_total=$6,pct_executado=$7,inicio=$8,termino=$9,status=$10,obs=$11 WHERE id=$12 RETURNING *',[empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,pct_executado||0,inicio,termino,status,obs,req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/contratos/:id', auth, async (req, res) => {
  await db.query('DELETE FROM contratos WHERE id=$1',[req.params.id]); res.status(204).end();
});

// ── Medições ────────────────────────────────────────────────────
app.get('/api/medicoes', auth, async (req, res) => {
  let q = `SELECT m.*,o.nome as obra_nome,f.nome_fantasia as fornecedor_nome,e.nome_fantasia as empresa_nome,c.numero as contrato_numero
           FROM medicoes m JOIN obras o ON m.obra_id=o.id JOIN fornecedores f ON m.fornecedor_id=f.id
           JOIN empresas e ON m.empresa_id=e.id JOIN contratos c ON m.contrato_id=c.id WHERE 1=1`;
  const params = [];
  if(req.query.empresa_id) { params.push(req.query.empresa_id); q += ` AND m.empresa_id=$${params.length}`; }
  if(req.query.status) { params.push(req.query.status); q += ` AND m.status=$${params.length}`; }
  if(req.query.periodo) { params.push(req.query.periodo); q += ` AND m.periodo=$${params.length}`; }
  q += ' ORDER BY m.criado_em DESC';
  res.json((await db.query(q, params)).rows);
});
app.get('/api/medicoes/:id', auth, async (req, res) => {
  const r = await db.query(`
    SELECT m.*,
      e.razao_social  AS empresa_nome,
      o.nome          AS obra_nome,
      f.razao_social  AS fornecedor_nome,
      f.email_assin   AS fornecedor_email_assin,
      f.email_nf      AS fornecedor_email_nf,
      f.tel           AS fornecedor_tel,
      c.numero        AS contrato_numero
    FROM medicoes m
    LEFT JOIN empresas   e ON e.id = m.empresa_id
    LEFT JOIN obras      o ON o.id = m.obra_id
    LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
    LEFT JOIN contratos  c ON c.id = m.contrato_id
    WHERE m.id = $1`, [req.params.id]);
  if(!r.rows[0]) return res.status(404).json({error:'Não encontrado'});
  const aprs = await db.query('SELECT * FROM aprovacoes WHERE medicao_id=$1 ORDER BY data_hora',[req.params.id]);
  const evs  = await db.query('SELECT * FROM evidencias WHERE medicao_id=$1',[req.params.id]);
  res.json({ ...r.rows[0], aprovacoes: aprs.rows, evidencias: evs.rows });
});
app.post('/api/medicoes', auth, async (req, res) => {
  const { empresa_id,obra_id,fornecedor_id,contrato_id,periodo,codigo,pct_anterior,pct_mes,pct_total,valor_medicao,valor_acumulado,descricao,status } = req.body;
  const r = await db.query(`INSERT INTO medicoes(empresa_id,obra_id,fornecedor_id,contrato_id,periodo,codigo,pct_anterior,pct_mes,pct_total,valor_medicao,valor_acumulado,descricao,status,criado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [empresa_id,obra_id,fornecedor_id,contrato_id,periodo,codigo,pct_anterior||0,pct_mes,pct_total,valor_medicao,valor_acumulado,descricao,status||'Rascunho',req.user.nome]);
  if(status && status !== 'Rascunho') {
    await db.query('INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
      [r.rows[0].id,'Sistema','lançado',req.user.nome,'Medição lançada para aprovação']);
  }
  res.status(201).json(r.rows[0]);
});
app.put('/api/medicoes/:id', auth, async (req, res) => {
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1',[req.params.id]);
  if(!m.rows[0]) return res.status(404).json({error:'Não encontrado'});
  const { descricao, status } = req.body;
  const r = await db.query('UPDATE medicoes SET descricao=$1,status=$2 WHERE id=$3 RETURNING *',[descricao,status,req.params.id]);
  res.json(r.rows[0]);
});

// ── Aprovações ──────────────────────────────────────────────────
app.post('/api/medicoes/:id/aprovar', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { comentario } = req.body;
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1',[id]);
  if(!m.rows[0]) return res.status(404).json({error:'Não encontrado'});
  const med = m.rows[0];
  const lvMap = {'Aguardando N1':'N1','Aguardando N2':'N2','Aguardando N3':'N3'};
  const nivel = lvMap[med.status];
  if(!nivel) return res.status(400).json({error:'Medição não está em alçada de aprovação'});
  await db.query('INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',[id,nivel,'aprovado',req.user.nome,comentario||'']);
  const nextStatus = {'Aguardando N1':'Aguardando N2','Aguardando N2':'Aguardando N3','Aguardando N3':'Aprovado'};
  let novoStatus = nextStatus[med.status];
  if(novoStatus === 'Aprovado') {
    const assinCfg = await db.query("SELECT valor FROM configuracoes WHERE chave='assinatura'");
    const assin = assinCfg.rows[0] ? assinCfg.rows[0].valor : {};
    if(assin.ativo) novoStatus = 'Em Assinatura';
  }
  await db.query('UPDATE medicoes SET status=$1 WHERE id=$2',[novoStatus,id]);
  res.json({ ok: true, novoStatus });
});

app.post('/api/medicoes/:id/enviar-assinatura', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { email_fornecedor, tel_fornecedor, email_remetente } = req.body;
    if(!email_fornecedor && !tel_fornecedor) return res.status(400).json({ error: 'Informe e-mail ou telefone do fornecedor' });

    const r = await db.query(`
      SELECT m.*, e.razao_social AS empresa_nome, o.nome AS obra_nome,
             f.razao_social AS fornecedor_nome, c.numero AS contrato_numero
      FROM medicoes m
      LEFT JOIN empresas e ON e.id = m.empresa_id
      LEFT JOIN obras o ON o.id = m.obra_id
      LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      LEFT JOIN contratos c ON c.id = m.contrato_id
      WHERE m.id = $1`, [id]);
    if(!r.rows[0]) return res.status(404).json({ error: 'Medição não encontrada' });
    const med = r.rows[0];
    if(!['Aprovado','Em Assinatura'].includes(med.status)) return res.status(400).json({ error: 'Medição não está aprovada' });

    // Atualiza status para Em Assinatura se ainda Aprovado
    if(med.status === 'Aprovado') {
      await db.query("UPDATE medicoes SET status='Em Assinatura' WHERE id=$1", [id]);
    }

    // Registra ação no histórico
    await db.query('INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
      [id, 'Sistema', 'lançado', req.user.nome,
       `Documento enviado para assinatura — Destinatário: ${email_fornecedor||tel_fornecedor}${email_remetente ? ' · Cópia: '+email_remetente : ''}`]);

    // TODO: integrar com provedor de assinatura (d4sign, ClickSign, etc.)
    // Por ora retorna o texto do documento para o frontend exibir/enviar
    const fmt = (v) => parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const periodoLabel = (p) => { if(!p) return p; const [y,m] = p.split('-'); const meses=['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']; return `${meses[parseInt(m)]}/${y}`; };
    const docTexto = `AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL\n${'='.repeat(50)}\n\nEmpresa: ${med.empresa_nome}\nObra: ${med.obra_nome}\nFornecedor: ${med.fornecedor_nome}\nContrato: ${med.contrato_numero}\nCódigo da Medição: ${med.codigo}\nPeríodo de Referência: ${periodoLabel(med.periodo)}\n\nEVOLUÇÃO PERCENTUAL\n% Anterior (acumulado): ${med.pct_anterior}%\n% Medido neste período: ${med.pct_mes}%\n% Acumulado total: ${med.pct_total}%\n\nVALOR AUTORIZADO PARA EMISSÃO DA NF\nValor desta medição: R$ ${fmt(med.valor_medicao)}\nValor acumulado: R$ ${fmt(med.valor_acumulado)}\n\nSERVIÇOS EXECUTADOS\n${med.descricao||'Conforme contrato vigente.'}\n\n${'='.repeat(50)}\nIMPORTANTE: A Nota Fiscal deverá ser emitida no valor de\nR$ ${fmt(med.valor_medicao)} e obrigatoriamente incluir o\ncódigo ${med.codigo} no campo Observações / Dados Adicionais.\n${'='.repeat(50)}\n\nAutorizado por: ${req.user.nome}\nData: ${new Date().toLocaleDateString('pt-BR')}`;

    res.json({ ok: true, novoStatus: 'Em Assinatura', docTexto, destinatario: email_fornecedor||tel_fornecedor });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.post('/api/medicoes/:id/reprovar', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { motivo } = req.body;
  if(!motivo) return res.status(400).json({error:'Motivo obrigatório'});
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1',[id]);
  if(!m.rows[0]) return res.status(404).json({error:'Não encontrado'});
  const lvMap = {'Aguardando N1':'N1','Aguardando N2':'N2','Aguardando N3':'N3'};
  const nivel = lvMap[m.rows[0].status];
  if(!nivel) return res.status(400).json({error:'Status inválido para reprovação'});
  await db.query('INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',[id,nivel,'reprovado',req.user.nome,motivo]);
  await db.query("UPDATE medicoes SET status='Reprovado' WHERE id=$1",[id]);
  res.json({ ok: true });
});

// ── Upload de evidências ────────────────────────────────────────
app.post('/api/medicoes/:id/evidencias', auth, upload.array('files', 20), async (req, res) => {
  const medicaoId = parseInt(req.params.id);
  const inserted = [];
  for(const file of req.files||[]) {
    const ext = path.extname(file.originalname).toLowerCase();
    const tipo = ['.jpg','.jpeg','.png','.gif'].includes(ext)?'img':['.pdf'].includes(ext)?'pdf':['.mp4','.mov','.avi'].includes(ext)?'video':'doc';
    const r = await db.query('INSERT INTO evidencias(medicao_id,nome,tipo,tamanho,caminho) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [medicaoId,file.originalname,tipo,(file.size/1024/1024).toFixed(1)+'MB',file.filename]);
    inserted.push(r.rows[0]);
  }
  res.status(201).json(inserted);
});

// ── Alçadas ─────────────────────────────────────────────────────
app.get('/api/alcadas', auth, async (req, res) => {
  const q = req.query.empresa_id
    ? 'SELECT a.*,e.nome_fantasia as empresa_nome,o.nome as obra_nome FROM alcadas a JOIN empresas e ON a.empresa_id=e.id LEFT JOIN obras o ON a.obra_id=o.id WHERE a.empresa_id=$1 ORDER BY a.nome'
    : 'SELECT a.*,e.nome_fantasia as empresa_nome,o.nome as obra_nome FROM alcadas a JOIN empresas e ON a.empresa_id=e.id LEFT JOIN obras o ON a.obra_id=o.id ORDER BY a.nome';
  const r = await db.query(q, req.query.empresa_id ? [req.query.empresa_id] : []);
  res.json(r.rows);
});
app.post('/api/alcadas', auth, async (req, res) => {
  const { empresa_id,obra_id,nome,n1_titulo,n1_grupos,n1_prazo,n2_titulo,n2_grupos,n2_prazo,n3_titulo,n3_grupos,n3_prazo,escalonamento,escalonamento_dias,email_copia } = req.body;
  const r = await db.query(`INSERT INTO alcadas(empresa_id,obra_id,nome,n1_titulo,n1_grupos,n1_prazo,n2_titulo,n2_grupos,n2_prazo,n3_titulo,n3_grupos,n3_prazo,escalonamento,escalonamento_dias,email_copia)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [empresa_id,obra_id||null,nome,n1_titulo,n1_grupos||[],n1_prazo||3,n2_titulo,n2_grupos||[],n2_prazo||2,n3_titulo,n3_grupos||[],n3_prazo||5,!!escalonamento,escalonamento_dias||2,email_copia||'']);
  res.status(201).json(r.rows[0]);
});
app.put('/api/alcadas/:id', auth, async (req, res) => {
  const { nome,n1_titulo,n1_grupos,n1_prazo,n2_titulo,n2_grupos,n2_prazo,n3_titulo,n3_grupos,n3_prazo,escalonamento,escalonamento_dias,email_copia,ativo } = req.body;
  const r = await db.query(`UPDATE alcadas SET nome=$1,n1_titulo=$2,n1_grupos=$3,n1_prazo=$4,n2_titulo=$5,n2_grupos=$6,n2_prazo=$7,n3_titulo=$8,n3_grupos=$9,n3_prazo=$10,escalonamento=$11,escalonamento_dias=$12,email_copia=$13,ativo=$14 WHERE id=$15 RETURNING *`,
    [nome,n1_titulo,n1_grupos||[],n1_prazo||3,n2_titulo,n2_grupos||[],n2_prazo||2,n3_titulo,n3_grupos||[],n3_prazo||5,!!escalonamento,escalonamento_dias||2,email_copia||'',ativo!==false,req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/alcadas/:id', auth, async (req, res) => {
  await db.query('DELETE FROM alcadas WHERE id=$1',[req.params.id]); res.status(204).end();
});

// ── Configurações ───────────────────────────────────────────────
app.get('/api/config/:chave', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM configuracoes WHERE chave=$1',[req.params.chave]);
  res.json(r.rows[0] || null);
});
app.put('/api/config/:chave', auth, async (req, res) => {
  const r = await db.query('INSERT INTO configuracoes(chave,valor) VALUES($1,$2) ON CONFLICT(chave) DO UPDATE SET valor=$2,atualizado_em=NOW() RETURNING *',[req.params.chave,req.body]);
  res.json(r.rows[0]);
});

// ── Dashboard stats ─────────────────────────────────────────────
app.get('/api/dashboard', auth, async (req, res) => {
  const periodo = new Date().toISOString().slice(0,7);
  const [doMes,aguardando,aprovadas,assinatura,valorMes] = await Promise.all([
    db.query("SELECT COUNT(*) FROM medicoes WHERE periodo=$1",[periodo]),
    db.query("SELECT COUNT(*) FROM medicoes WHERE status IN ('Aguardando N1','Aguardando N2','Aguardando N3')"),
    db.query("SELECT COUNT(*) FROM medicoes WHERE status='Aprovado'"),
    db.query("SELECT COUNT(*) FROM medicoes WHERE status='Em Assinatura'"),
    db.query("SELECT COALESCE(SUM(valor_medicao),0) as total FROM medicoes WHERE periodo=$1",[periodo]),
  ]);
  res.json({
    doMes: parseInt(doMes.rows[0].count),
    aguardando: parseInt(aguardando.rows[0].count),
    aprovadas: parseInt(aprovadas.rows[0].count),
    assinatura: parseInt(assinatura.rows[0].count),
    valorMes: parseFloat(valorMes.rows[0].total),
  });
});

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`HAMOA OBRAS API v3.0 rodando na porta ${PORT}`);
});

module.exports = app;
