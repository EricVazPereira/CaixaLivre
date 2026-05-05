const Firebird = require('node-firebird');

const opt = {
  host: 'localhost',
  port: 3050,
  database: 'C:/fenix/bd/ORESTRA.FDB',
  user: 'SYSDBA',
  password: 'qpalzm',
  lowercase_keys: false
};

function cols(db, table) {
  return new Promise((res, rej) => {
    const sql = `SELECT f.RDB$FIELD_NAME, t.RDB$TYPE_NAME
       FROM RDB$RELATION_FIELDS f
       LEFT JOIN RDB$TYPES t ON t.RDB$FIELD_NAME='RDB$FIELD_TYPE'
         AND t.RDB$TYPE=(SELECT s.RDB$FIELD_TYPE FROM RDB$FIELDS s WHERE s.RDB$FIELD_NAME=f.RDB$FIELD_SOURCE)
       WHERE f.RDB$RELATION_NAME='${table}'
       ORDER BY f.RDB$FIELD_POSITION`;
    db.query(sql, [], (err, rows) => {
      if (err) rej(err); else res(rows);
    });
  });
}

function sample(db, table) {
  return new Promise((res, rej) => {
    db.query(`SELECT FIRST 3 * FROM ${table}`, [], (err, rows) => {
      if (err) rej(err); else res(rows);
    });
  });
}

Firebird.attach(opt, async (err, db) => {
  if (err) { console.error('ERRO:', err.message); process.exit(1); }

  for (const t of ['USUARIO', 'FUNCAO', 'USUARIO_FUNCAO']) {
    console.log('\n=== ' + t + ' ===');
    try {
      const rows = await cols(db, t);
      rows.forEach(r => console.log(' ', r['RDB$FIELD_NAME'].trim(), '-', (r['RDB$TYPE_NAME'] || '').trim()));
      const s = await sample(db, t);
      s.forEach((row, i) => console.log('  [' + i + ']', JSON.stringify(row, null, 2).slice(0, 600)));
    } catch (e) {
      console.log('  ERRO:', e.message);
    }
  }

  // Generators e HISTORICO também
  console.log('\n=== GENERATORS ===');
  await new Promise(res => {
    db.query("SELECT RDB$GENERATOR_NAME FROM RDB$GENERATORS WHERE RDB$SYSTEM_FLAG = 0 ORDER BY RDB$GENERATOR_NAME", [], (err, rows) => {
      if (!err) rows.forEach(r => console.log(' ', r['RDB$GENERATOR_NAME'].trim()));
      res();
    });
  });

  console.log('\n=== HISTORICO MAIS RECENTE ===');
  await new Promise(res => {
    db.query("SELECT FIRST 1 ID_HISTORICO, NM_ESTACAO, DH_ABERTURA, CX_FECHADO FROM HISTORICO ORDER BY ID_HISTORICO DESC", [], (err, rows) => {
      if (!err && rows.length > 0) console.log(JSON.stringify(rows[0], null, 2));
      res();
    });
  });

  console.log('\n=== ST_CONTA values ===');
  await new Promise(res => {
    db.query("SELECT DISTINCT ST_CONTA FROM CONTA", [], (err, rows) => {
      if (!err) rows.forEach(r => console.log(' "' + r['ST_CONTA'] + '"'));
      res();
    });
  });

  db.detach();
});
