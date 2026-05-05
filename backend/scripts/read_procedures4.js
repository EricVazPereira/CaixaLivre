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

Firebird.attach(opt, (err, db) => {
  if (err) { console.error(err.message); process.exit(1); }

  db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err, tr) => {
    if (err) { console.error(err.message); db.detach(); return; }

    let idx = 0;

    function next() {
      if (idx >= PROCS.length) {
        tr.commit(() => db.detach());
        process.exit(0);
        return;
      }
      const name = PROCS[idx++];
      console.log(`\n${'='.repeat(55)}`);
      console.log(`PROCEDURE: ${name}`);
      console.log('='.repeat(55));

      tr.query(
        `SELECT RDB$PROCEDURE_SOURCE AS SRC FROM RDB$PROCEDURES WHERE TRIM(RDB$PROCEDURE_NAME) = '${name}'`,
        [],
        (err, rows) => {
          if (err || !rows.length) { console.log(err ? err.message : '(não encontrada)'); next(); return; }

          const blobFn = rows[0]['SRC'];
          if (typeof blobFn !== 'function') { console.log('(sem source)'); next(); return; }

          blobFn(tr, (err, name2, emitter) => {
            if (err || !emitter) { console.log(err ? err.message : '(blob vazio)'); next(); return; }
            let data = '';
            emitter.setEncoding('utf8');
            emitter.on('data', c => { data += c; });
            emitter.on('end', () => { console.log(data.slice(0, 3000)); next(); });
            emitter.on('error', e => { console.log('BLOB ERR:', e.message); next(); });
          });
        }
      );
    }

    next();
  });
});
