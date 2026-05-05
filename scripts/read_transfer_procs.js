const Firebird = require('node-firebird');

const opt = {
  host: 'localhost', port: 3050,
  database: 'C:/fenix/bd/ORESTRA.FDB',
  user: 'SYSDBA', password: 'qpalzm',
  lowercase_keys: false
};

const PROCS = [
  'TRANSFERE_CONTA',
  'TRANSFERE_CONTA_ANDROID',
  'TRANSFERE_CONTA_OFF_LINE',
  'GRAVA_CONSUMO_ANDROID',
  'FECHA_CONTA_ANDROID',
  'CHECK_CONTA_HISTORICO',
  'CHECK_CONTA_CONSUMO',
  'BUSCA_CONTA_PDV',
  'BUSCA_CONTA_ABERTA_PDV',
  'LOCALIZA_PRODUTO_PDV',
  'BUSCA_PRODUTO_PDV',
];

Firebird.attach(opt, (err, db) => {
  if (err) { console.error(err.message); process.exit(1); }

  db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err, tr) => {
    if (err) { console.error(err.message); db.detach(); return; }

    let idx = 0;

    function next() {
      if (idx >= PROCS.length) {
        tr.commit(() => { db.detach(); process.exit(0); });
        return;
      }
      const name = PROCS[idx++];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`PROCEDURE: ${name}`);
      console.log('='.repeat(60));

      tr.query(
        `SELECT RDB$PROCEDURE_SOURCE AS SRC FROM RDB$PROCEDURES WHERE TRIM(RDB$PROCEDURE_NAME) = '${name}'`,
        [],
        (err, rows) => {
          if (err || !rows.length) { console.log(err ? err.message : '(não encontrada)'); next(); return; }

          const blobFn = rows[0]['SRC'];
          if (Buffer.isBuffer(blobFn)) { console.log(blobFn.toString('utf8')); next(); return; }
          if (typeof blobFn !== 'function') { console.log('(sem source)'); next(); return; }

          blobFn(tr, (err, name2, emitter) => {
            if (err) { console.log('ERR:', err.message); next(); return; }
            if (Buffer.isBuffer(emitter)) { console.log(emitter.toString('utf8')); next(); return; }
            if (!emitter) { console.log('(vazio)'); next(); return; }

            let data = Buffer.alloc(0);
            emitter.on('data', c => { data = Buffer.concat([data, Buffer.isBuffer(c) ? c : Buffer.from(c)]); });
            emitter.on('end', () => { console.log(data.toString('utf8')); next(); });
            emitter.on('error', e => { console.log('STREAM ERR:', e.message); next(); });
          });
        }
      );
    }

    next();
  });
});
