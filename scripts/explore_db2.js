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
    db.query(`SELECT FIRST 1 * FROM ${table}`, [], (err, rows) => {
      if (err) rej(err); else res(rows);
    });
  });
}

Firebird.attach(opt, async (err, db) => {
  if (err) { console.error('ERRO:', err.message); process.exit(1); }

  for (const t of ['HISTORICO', 'CONSUMO']) {
    console.log('\n=== ' + t + ' ===');
    try {
      const rows = await cols(db, t);
      rows.forEach(r => console.log(' ', r['RDB$FIELD_NAME'].trim(), '-', (r['RDB$TYPE_NAME'] || '').trim()));
      const s = await sample(db, t);
      if (s.length > 0) {
        console.log('  [amostra]', JSON.stringify(s[0], null, 2).slice(0, 800));
      }
    } catch (e) {
      console.log('  ERRO:', e.message);
    }
  }

  db.detach();
});
