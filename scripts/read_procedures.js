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
  'BUSCA_PRODUTO_PDV',
  'GRAVA_CONSUMO_ZERAFILA',
  'GRAVA_ESTOQUE_ADM',
  'CHECK_CONTA_HISTORICO',
];

Firebird.attach(opt, (err, db) => {
  if (err) { console.error(err.message); process.exit(1); }

  let done = 0;
  PROCS.forEach(name => {
    db.query(
      `SELECT RDB$PROCEDURE_SOURCE FROM RDB$PROCEDURES WHERE RDB$PROCEDURE_NAME = '${name}'`,
      [],
      (err, rows) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`PROCEDURE: ${name}`);
        console.log('='.repeat(60));
        if (err) { console.log('ERRO:', err.message); }
        else if (!rows.length) { console.log('(não encontrada)'); }
        else {
          const src = rows[0]['RDB$PROCEDURE_SOURCE'];
          console.log(src ? src.toString().slice(0, 2000) : '(sem source)');
        }
        if (++done === PROCS.length) db.detach();
      }
    );
  });
});
