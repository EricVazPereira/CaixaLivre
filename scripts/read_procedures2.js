const { query } = require('../src/db');

const PROCS = [
  'PEGA_GEN_HISTORICO',
  'PEGA_GEN_CONTA',
  'PEGA_GEN_CONSUMO',
  'PEGA_NRGERADOR_AUTOMATICO',
  'GRAVA_CONSUMO_ZERAFILA',
  'GRAVA_ESTOQUE_ADM',
];

async function main() {
  for (const name of PROCS) {
    const rows = await query(
      `SELECT RDB$PROCEDURE_SOURCE AS SRC FROM RDB$PROCEDURES WHERE TRIM(RDB$PROCEDURE_NAME) = ?`,
      [name]
    );
    console.log(`\n${'='.repeat(55)}`);
    console.log(`PROCEDURE: ${name}`);
    console.log('='.repeat(55));
    if (!rows.length) { console.log('(não encontrada)'); continue; }
    const src = rows[0]['SRC'];
    console.log(src ? src.toString().slice(0, 3000) : '(sem source)');
  }
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
