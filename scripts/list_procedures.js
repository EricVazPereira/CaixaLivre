const Firebird = require('node-firebird');

const opt = {
  host: 'localhost', port: 3050,
  database: 'C:/fenix/bd/ORESTRA.FDB',
  user: 'SYSDBA', password: 'qpalzm',
  lowercase_keys: false
};

Firebird.attach(opt, (err, db) => {
  if (err) { console.error(err.message); process.exit(1); }

  // Lista todas as procedures
  db.query(
    `SELECT RDB$PROCEDURE_NAME FROM RDB$PROCEDURES WHERE RDB$SYSTEM_FLAG = 0 ORDER BY RDB$PROCEDURE_NAME`,
    [],
    (err, rows) => {
      if (err) { console.error(err.message); db.detach(); return; }

      console.log('=== STORED PROCEDURES ===');
      rows.forEach(r => console.log(r['RDB$PROCEDURE_NAME'].trim()));

      // Filtra as relacionadas a caixa/historico
      const relacionadas = rows
        .map(r => r['RDB$PROCEDURE_NAME'].trim())
        .filter(n => /HIST|CAIXA|ABRIR|FECHAR|FECHA|ABRIR|CX|OPEN|CLOSE|CONTA/i.test(n));

      console.log('\n=== RELACIONADAS A CAIXA/HISTORICO ===');
      relacionadas.forEach(n => console.log(n));

      db.detach();
    }
  );
});
