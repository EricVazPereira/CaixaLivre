const Firebird = require('node-firebird');

const opt = {
  host: 'localhost', port: 3050,
  database: 'C:/fenix/bd/ORESTRA.FDB',
  user: 'SYSDBA', password: 'qpalzm',
  lowercase_keys: false
};

Firebird.attach(opt, (err, db) => {
  if (err) { console.error(err.message); process.exit(1); }

  // Get CAIXA structure
  db.query(
    `SELECT rf.RDB$FIELD_NAME, rf.RDB$NULL_FLAG, f.RDB$FIELD_TYPE, f.RDB$FIELD_LENGTH, rf.RDB$DEFAULT_SOURCE
     FROM RDB$RELATION_FIELDS rf
     JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
     WHERE rf.RDB$RELATION_NAME = 'CAIXA'
     ORDER BY rf.RDB$FIELD_POSITION`,
    [],
    (err, rows) => {
      if (err) { console.error('CAIXA structure error:', err.message); }
      else {
        console.log('\n=== CAIXA STRUCTURE ===');
        rows.forEach(r => {
          const name = (r['RDB$FIELD_NAME'] || '').trim();
          const nullable = r['RDB$NULL_FLAG'] === 1 ? 'NOT NULL' : 'NULL';
          const type = r['RDB$FIELD_TYPE'];
          const def = r['RDB$DEFAULT_SOURCE'] || '';
          console.log(`  ${name.padEnd(30)} type=${type} ${nullable} ${def}`);
        });
      }

      // Check if CAIXALIVRE-01 exists in CAIXA
      db.query(
        `SELECT NM_ESTACAO, ID_HISTORICO FROM CAIXA WHERE NM_ESTACAO = 'CAIXALIVRE-01'`,
        [],
        (err2, rows2) => {
          if (err2) console.log('\nCAIXA query error:', err2.message);
          else if (!rows2.length) console.log('\n⚠ CAIXALIVRE-01 NÃO encontrada na tabela CAIXA');
          else console.log('\n✅ CAIXALIVRE-01 encontrada na CAIXA:', JSON.stringify(rows2[0]));

          // Check generators GEN_T_CONTA and GEN_T_CONSUMO
          db.query(
            `SELECT GEN_ID(GEN_T_CONTA, 0) AS GT_CONTA, GEN_ID(GEN_T_CONSUMO, 0) AS GT_CONSUMO FROM RDB$DATABASE`,
            [],
            (err3, rows3) => {
              if (err3) console.log('\nGen query error:', err3.message);
              else console.log('\n=== GENERATORS ===\n', JSON.stringify(rows3[0]));
              db.detach();
              process.exit(0);
            }
          );
        }
      );
    }
  );
});
