/**
 * limpar-portal-nfs.js
 * Apaga todos os registros de portal_nfs (e seus arquivos no storage)
 * para facilitar a repetição de testes.
 *
 * Uso:
 *   node api/scripts/limpar-portal-nfs.js
 *
 * Dentro do container:
 *   docker exec -it construtivo-api node scripts/limpar-portal-nfs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const db            = require('../db');
const storageHelper = require('../helpers/storage');
const path          = require('path');
const fs            = require('fs');

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  LIMPEZA DE TESTES — portal_nfs');
  console.log('═══════════════════════════════════════════\n');

  // 1. Busca todos os registros
  const { rows } = await db.query(
    `SELECT id, medicao_id, fornecedor_id, nome_arquivo, provider, caminho, url_storage, status_fin
       FROM portal_nfs ORDER BY id`
  );

  if (!rows.length) {
    console.log('✅ Nenhum registro encontrado em portal_nfs. Nada a apagar.');
    await db.end();
    return;
  }

  console.log(`📋 ${rows.length} registro(s) encontrado(s):\n`);
  rows.forEach(r => {
    console.log(`  [${r.id}] Medição ${r.medicao_id} | ${r.nome_arquivo} | ${r.status_fin} | provider: ${r.provider}`);
  });
  console.log('');

  // 2. Apaga arquivos do storage
  let apagados = 0, erros = 0;
  for (const r of rows) {
    try {
      if (r.provider === 'local') {
        const localPath = path.join('/app/uploads', r.caminho || '');
        if (r.caminho && fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
          console.log(`  🗑  Arquivo local apagado: ${localPath}`);
          apagados++;
        } else {
          console.log(`  ⚠  Arquivo local não encontrado (já removido?): ${r.caminho}`);
        }
      } else {
        // S3 / GDrive — usa helper
        await storageHelper.deleteFile(r);
        console.log(`  🗑  Arquivo ${r.provider} apagado: ${r.caminho}`);
        apagados++;
      }
    } catch (e) {
      console.warn(`  ❌ Erro ao apagar arquivo id=${r.id}: ${e.message}`);
      erros++;
    }
  }

  // 3. Apaga todos os registros do banco
  const del = await db.query(`DELETE FROM portal_nfs RETURNING id`);
  console.log(`\n✅ ${del.rows.length} registro(s) removido(s) do banco.`);
  console.log(`   Arquivos: ${apagados} apagado(s), ${erros} erro(s).\n`);

  await db.end();
  console.log('Concluído.');
}

main().catch(e => {
  console.error('\n❌ Erro fatal:', e.message);
  process.exit(1);
});
