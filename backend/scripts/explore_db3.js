const Firebird = require('node-firebird');

const opt = {
  host: 'localhost',
  port: 3050,
  database: 'C:/fenix/bd/ORESTRA.FDB',
  user: 'SYSDBA',
  password: 'qpalzm',
  lowercase_keys: false
};

Firebird.attach(opt, async (err, db) => {
  if (err) { console.error('ERRO:', err.message); process.exit(1); }

  // Listar generators
  db.query("SELECT RDB$GENERATOR_NAME, RDB$GENERATOR_ID FROM RDB$GENERATORS WHERE RDB$SYSTEM_FLAG = 0 ORDER BY RDB$GENERATOR_NAME", [], (err, rows) => {
    if (err) { console.error(err); db.detach(); return; }
    console.log('=== GENERATORS ===');
    rows.forEach(r => console.log(' ', r['RDB$GENERATOR_NAME'].trim()));

    // Ver historico aberto
    db.query("SELECT FIRST 1 ID_HISTORICO, NM_ESTACAO, DH_ABERTURA, CX_FECHADO FROM HISTORICO ORDER BY ID_HISTORICO DESC", [], (err2, rows2) => {
      if (err2) { console.error(err2); db.detach(); return; }
      console.log('\n=== HISTORICO MAIS RECENTE ===');
      console.log(JSON.stringify(rows2[0], null, 2));

      // Ver ST_CONTA values
      db.query("SELECT DISTINCT ST_CONTA FROM CONTA", [], (err3, rows3) => {
        if (err3) { console.error(err3); db.detach(); return; }
        console.log('\n=== ST_CONTA values ===');
        rows3.forEach(r => console.log(' "' + r['ST_CONTA'] + '"'));
        db.detach();
      });
    });
  });
});
