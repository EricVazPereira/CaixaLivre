const Firebird = require('node-firebird');

const opt = {
  host: 'localhost', port: 3050,
  database: 'C:/fenix/bd/ORESTRA.FDB',
  user: 'SYSDBA', password: 'qpalzm',
  lowercase_keys: false
};

const PROCS = [
  'PEGA_GEN_HISTORICO',
  'PEGA_GEN_CONTA',
  'PEGA_GEN_CONSUMO',
  'PEGA_NRGERADOR_AUTOMATICO',
  'GRAVA_CONSUMO_ZERAFILA',
  'GRAVA_ESTOQUE_ADM',
];

function readBlob(blobField, db) {
  return new Promise((resolve, reject) => {
    if (!blobField || typeof blobField !== 'function') {
      return resolve('(sem source)');
    }
    blobField(db, (err, name, emitter) => {
      if (err) return reject(err);
      if (!emitter) return resolve('(blob vazio)');
      let data = '';
      emitter.setEncoding('utf8');
      emitter.on('data', chunk => { data += chunk; });
      emitter.on('end', () => resolve(data));
      emitter.on('error', reject);
    });
  });
}

Firebird.attach(opt, async (err, db) => {
  if (err) { console.error(err.message); process.exit(1); }

  for (const name of PROCS) {
    await new Promise((res) => {
      db.query(
        `SELECT RDB$PROCEDURE_SOURCE AS SRC FROM RDB$PROCEDURES WHERE TRIM(RDB$PROCEDURE_NAME) = '${name}'`,
        [],
        async (err, rows) => {
          console.log(`\n${'='.repeat(55)}`);
          console.log(`PROCEDURE: ${name}`);
          console.log('='.repeat(55));

          if (err) { console.log('ERRO:', err.message); res(); return; }
          if (!rows.length) { console.log('(não encontrada)'); res(); return; }

          const src = await readBlob(rows[0]['SRC'], db).catch(e => `ERRO BLOB: ${e.message}`);
          console.log(src ? src.slice(0, 3000) : '(vazio)');
          res();
        }
      );
    });
  }

  db.detach();
  process.exit(0);
});
