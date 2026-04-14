/**
 * CONSTRUTIVO OBRAS — Helper de Armazenamento de Evidências
 * Suporta: local | AWS S3 | Google Drive (Service Account)
 *
 * O provider ativo é lido da tabela configuracoes (chave: 'storage').
 * Estrutura do valor JSON:
 * {
 *   provider: 'local' | 's3' | 'gdrive',
 *   s3: {
 *     bucket: 'meu-bucket',
 *     region: 'sa-east-1',
 *     accessKeyId: 'AKIA...',
 *     secretAccessKey: 'xxx',
 *     prefixo: 'evidencias/',          // opcional
 *     url_base: 'https://...',         // opcional — para buckets públicos
 *     acl_publico: false               // true = usa ACL public-read (bucket público)
 *   },
 *   gdrive: {
 *     folderId: '1AbC...',             // ID da pasta de destino
 *     serviceAccountKey: '{...}'       // JSON da service account (string ou objeto)
 *   }
 * }
 */

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

// ─── Carrega configuração ──────────────────────────────────────────────────
async function getConfig() {
  try {
    const r = await db.query(`SELECT valor FROM configuracoes WHERE chave='storage'`);
    return r.rows[0]?.valor || { provider: 'local' };
  } catch {
    return { provider: 'local' };
  }
}

// ─── Upload de arquivo ─────────────────────────────────────────────────────
// localPath: caminho temporário do arquivo (gerado pelo multer)
// originalName: nome original do arquivo
// mimeType: content-type do arquivo
// Retorna: { provider, caminho, url_storage }
async function uploadFile(localPath, originalName, mimeType) {
  const cfg      = await getConfig();
  const provider = cfg.provider || 'local';

  try {
    if (provider === 's3' && cfg.s3?.bucket) {
      return await _uploadS3(cfg.s3, localPath, originalName, mimeType);
    } else if (provider === 'gdrive' && cfg.gdrive?.folderId) {
      return await _uploadGDrive(cfg.gdrive, localPath, originalName, mimeType);
    } else {
      return _keepLocal(localPath, originalName);
    }
  } catch (err) {
    console.error(`[storage.uploadFile] Falha no provider "${provider}":`, err.message);
    // fallback: mantém local em caso de erro
    return _keepLocal(localPath, originalName);
  }
}

// ─── Upload para AWS S3 ────────────────────────────────────────────────────
async function _uploadS3(s3cfg, localPath, originalName, mimeType) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

  const client = new S3Client({
    region: s3cfg.region || 'sa-east-1',
    credentials: {
      accessKeyId:     s3cfg.accessKeyId,
      secretAccessKey: s3cfg.secretAccessKey,
    },
  });

  const ext    = path.extname(originalName).toLowerCase();
  const slug   = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;
  const prefix = (s3cfg.prefixo || 'evidencias/').replace(/\/$/, '') + '/';
  const key    = prefix + slug;

  const body = fs.readFileSync(localPath);

  const cmd = new PutObjectCommand({
    Bucket:      s3cfg.bucket,
    Key:         key,
    Body:        body,
    ContentType: mimeType || 'application/octet-stream',
    ...(s3cfg.acl_publico ? { ACL: 'public-read' } : {}),
  });

  await client.send(cmd);

  // URL de acesso: só guarda URL fixa se bucket for público (acl_publico=true)
  // Bucket privado → url_storage=null → getViewUrl() gera URL assinada on-demand
  const url_storage = s3cfg.acl_publico
    ? (s3cfg.url_base
        ? `${s3cfg.url_base.replace(/\/$/, '')}/${key}`
        : `https://${s3cfg.bucket}.s3.${s3cfg.region || 'sa-east-1'}.amazonaws.com/${key}`)
    : null;

  return { provider: 's3', caminho: key, url_storage };
}

// ─── Upload para Google Drive ──────────────────────────────────────────────
async function _uploadGDrive(gdriveCfg, localPath, originalName, mimeType) {
  const { google } = require('googleapis');

  const keyFile = _parseServiceAccountKey(gdriveCfg.serviceAccountKey);

  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const meta = {
    name:    originalName,
    parents: gdriveCfg.folderId ? [gdriveCfg.folderId] : [],
  };

  const resp = await drive.files.create({
    requestBody: meta,
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body:     fs.createReadStream(localPath),
    },
    fields: 'id,webViewLink,webContentLink',
  });

  // Torna o arquivo legível por qualquer pessoa com o link
  await drive.permissions.create({
    fileId:      resp.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    provider:    'gdrive',
    caminho:     resp.data.id,           // fileId do Drive
    url_storage: resp.data.webViewLink,  // link para visualização
  };
}

// ─── Mantém arquivo em disco local ────────────────────────────────────────
function _keepLocal(localPath, originalName) {
  // multer já gravou o arquivo em /app/uploads; caminho = filename gerado
  return {
    provider:    'local',
    caminho:     path.basename(localPath),
    url_storage: null,
  };
}

// ─── Gera URL de visualização (signed URL para S3 privado) ────────────────
async function getViewUrl(evidencia) {
  if (evidencia.url_storage) return evidencia.url_storage;

  if (evidencia.provider === 's3') {
    try {
      const cfg = await getConfig();
      if (!cfg.s3?.bucket) return null;
      const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl }               = require('@aws-sdk/s3-request-presigner');
      const client = new S3Client({
        region:      cfg.s3.region || 'sa-east-1',
        credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
      });
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: cfg.s3.bucket, Key: evidencia.caminho }),
        { expiresIn: 3600 } // válida por 1 hora
      );
    } catch (e) {
      console.error('[storage.getViewUrl]', e.message);
      return null;
    }
  }

  if (evidencia.provider === 'local' || !evidencia.provider) {
    // URL relativa servida pelo nginx / express-static se configurado
    return `/uploads/${evidencia.caminho}`;
  }

  return null;
}

// ─── Remove arquivo do storage ─────────────────────────────────────────────
async function deleteFile(evidencia) {
  const cfg = await getConfig();
  try {
    if (evidencia.provider === 's3') {
      if (!cfg.s3?.bucket) return;
      const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const client = new S3Client({
        region:      cfg.s3.region || 'sa-east-1',
        credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
      });
      await client.send(new DeleteObjectCommand({ Bucket: cfg.s3.bucket, Key: evidencia.caminho }));
    } else if (evidencia.provider === 'gdrive') {
      if (!cfg.gdrive?.serviceAccountKey) return;
      const { google } = require('googleapis');
      const keyFile = _parseServiceAccountKey(cfg.gdrive.serviceAccountKey);
      const auth = new google.auth.GoogleAuth({
        credentials: keyFile,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });
      const drive = google.drive({ version: 'v3', auth });
      await drive.files.delete({ fileId: evidencia.caminho });
    } else {
      // local
      const localPath = path.join('/app/uploads', evidencia.caminho || '');
      if (evidencia.caminho && fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }
  } catch (e) {
    console.warn('[storage.deleteFile] Aviso:', e.message);
  }
}

// ─── Testa conexão com S3 ──────────────────────────────────────────────────
async function testS3(s3cfg) {
  // Validação básica antes de chamar a AWS
  if (!s3cfg.bucket)          throw new Error('Informe o nome do bucket.');
  if (!s3cfg.accessKeyId)     throw new Error('Informe o Access Key ID.');
  if (!s3cfg.secretAccessKey) throw new Error('Informe o Secret Access Key.');
  if (!s3cfg.accessKeyId.startsWith('AKIA') && !s3cfg.accessKeyId.startsWith('ASIA'))
    throw new Error(`Access Key ID inválido — deve começar com "AKIA" ou "ASIA". Valor recebido: "${s3cfg.accessKeyId.slice(0,8)}..."`);

  let S3Client, HeadBucketCommand;
  try {
    ({ S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3'));
  } catch {
    throw new Error('Pacote @aws-sdk/client-s3 não instalado. Reconstrua o container: docker compose up -d --build construtivo-api');
  }

  const client = new S3Client({
    region:      s3cfg.region || 'sa-east-1',
    credentials: { accessKeyId: s3cfg.accessKeyId, secretAccessKey: s3cfg.secretAccessKey },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: s3cfg.bucket }));
  } catch (err) {
    // Log completo para depuração no servidor
    console.error('[testS3] Erro bruto:', JSON.stringify({
      name:        err.name,
      message:     err.message,
      Code:        err.Code,
      code:        err.code,
      statusCode:  err.$metadata?.httpStatusCode,
      requestId:   err.$metadata?.requestId,
      cfId:        err.$metadata?.cfId,
    }, null, 2));

    // HTTP status code é o método mais confiável no SDK v3
    const httpStatus = err.$metadata?.httpStatusCode;
    const errName    = err.name || '';
    const errMsg     = err.message || '';
    const errCode    = err.Code || err.code || '';

    // Sem acesso à rede
    if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo') || errMsg.includes('ECONNREFUSED'))
      throw new Error('Sem acesso à internet ou DNS não resolve o endpoint da AWS. Verifique a conexão do servidor.');

    // 301 — bucket em outra região
    if (httpStatus === 301 || errName === 'PermanentRedirect' || errCode === 'PermanentRedirect')
      throw new Error(`Bucket "${s3cfg.bucket}" está em outra região. Corrija o campo "Região" na configuração.`);

    // 400 — credenciais inválidas / mal-formadas
    if (httpStatus === 400 ||
        errName === 'InvalidClientTokenId' || errCode === 'InvalidClientTokenId' ||
        errName === 'AuthFailure'          || errCode === 'AuthFailure')
      throw new Error('Access Key ID inválido ou não reconhecido pela AWS. Verifique a chave no IAM (deve começar com AKIA).');

    // 403 — credencial certa mas sem permissão (ou Secret errada)
    if (httpStatus === 403 ||
        errName === 'Forbidden'            || errCode === 'Forbidden' ||
        errName === 'SignatureDoesNotMatch'|| errCode === 'SignatureDoesNotMatch' ||
        errName === 'InvalidAccessKeyId'   || errCode === 'InvalidAccessKeyId')
      throw new Error(
        `Acesso negado (403). Causas comuns:\n` +
        `• Secret Access Key incorreta (verifique se não tem espaços)\n` +
        `• Usuário IAM sem permissão s3:HeadBucket / s3:PutObject no bucket "${s3cfg.bucket}"\n` +
        `• Bucket pertence a outra conta AWS`
      );

    // 404 — bucket não existe nessa região
    if (httpStatus === 404 ||
        errName === 'NoSuchBucket' || errCode === 'NoSuchBucket' ||
        errName === 'NotFound'     || errCode === 'NotFound')
      throw new Error(`Bucket "${s3cfg.bucket}" não encontrado na região "${s3cfg.region || 'sa-east-1'}". Verifique o nome e a região.`);

    // Fallback com todos os detalhes disponíveis
    const detail = [
      httpStatus  ? `HTTP ${httpStatus}` : null,
      errName     ? `name: ${errName}`   : null,
      errCode     ? `code: ${errCode}`   : null,
      errMsg      ? errMsg               : null,
    ].filter(Boolean).join(' | ');
    throw new Error(`Erro AWS: ${detail || 'sem detalhes — veja os logs do container com: docker compose logs construtivo-api'}`);
  }
}

// ─── Parse e validação da Service Account Key ─────────────────────────────
// Aceita string JSON ou objeto já parseado. Lança erro claro se inválido.
function _parseServiceAccountKey(raw) {
  let key;
  try {
    key = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error(
      'O campo "Service Account Key" contém JSON inválido. ' +
      'Você deve colar o conteúdo COMPLETO do arquivo .json baixado do Google Cloud Console ' +
      '(não uma API Key, não um e-mail, não um trecho do arquivo — o arquivo JSON inteiro).'
    );
  }
  if (!key || typeof key !== 'object') {
    throw new Error('O JSON fornecido não é um objeto válido de Service Account.');
  }
  if (key.type !== 'service_account') {
    throw new Error(
      `JSON inválido: esperado "type": "service_account", mas encontrado "${key.type || '(vazio)'}". ` +
      'Verifique se você baixou a chave correta no Google Cloud Console em IAM → Service Accounts → Chaves.'
    );
  }
  if (!key.client_email || !key.private_key) {
    throw new Error(
      'O JSON da Service Account está incompleto — faltam "client_email" e/ou "private_key". ' +
      'Baixe novamente a chave no Google Cloud Console.'
    );
  }
  return key;
}

// ─── Testa conexão com Google Drive ───────────────────────────────────────
async function testGDrive(gdriveCfg) {
  if (!gdriveCfg.folderId) throw new Error('Informe o ID da pasta do Google Drive.');
  if (!gdriveCfg.serviceAccountKey) throw new Error('Cole o JSON da Service Account.');

  const keyFile = _parseServiceAccountKey(gdriveCfg.serviceAccountKey);

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // Tenta listar arquivos na pasta — confirma autenticação + acesso
  await drive.files.list({
    pageSize: 1,
    fields: 'files(id)',
    q: `'${gdriveCfg.folderId}' in parents and trashed=false`,
  });
}

module.exports = { getConfig, uploadFile, getViewUrl, deleteFile, testS3, testGDrive };
