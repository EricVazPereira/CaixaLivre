const Firebird = require('node-firebird');
const { DB_HOST, DB_DATABASE, DB_USER, DB_PASSWORD } = require('./config');

const options = {
  host:           DB_HOST,
  port:           3050,
  database:       DB_DATABASE,
  user:           DB_USER,
  password:       DB_PASSWORD,
  lowercase_keys: false,
  pageSize:       4096,
};

// Pool de até 5 conexões simultâneas
const pool = Firebird.pool(5, options);

/** Executa uma query simples (autocommit) */
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    pool.get((err, db) => {
      if (err) return reject(err);
      db.query(sql, params, (err2, rows) => {
        db.detach();
        if (err2) reject(err2);
        else resolve(rows || []);
      });
    });
  });
}

/**
 * Executa fn dentro de uma transação READ_COMMITTED.
 * fn recebe (trQuery, trNextval):
 *   - trQuery(sql, params) → Promise<rows>
 *   - trNextval(generator) → Promise<number>
 * Commit em sucesso, rollback em erro.
 */
function withTransaction(fn) {
  return new Promise((resolve, reject) => {
    pool.get((err, db) => {
      if (err) return reject(err);

      db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err2, tr) => {
        if (err2) { db.detach(); return reject(err2); }

        function trQuery(sql, params = []) {
          return new Promise((res, rej) => {
            tr.query(sql, params, (e, rows) => e ? rej(e) : res(rows || []));
          });
        }

        // Generators são independentes de transação — usamos tr.query por conveniência
        function trNextval(generator) {
          return trQuery(`SELECT GEN_ID(${generator}, 1) AS V FROM RDB$DATABASE`)
            .then(rows => rows[0]['V']);
        }

        fn(trQuery, trNextval)
          .then(result => {
            tr.commit(err3 => {
              db.detach();
              if (err3) reject(err3); else resolve(result);
            });
          })
          .catch(err3 => {
            tr.rollback(() => { db.detach(); reject(err3); });
          });
      });
    });
  });
}

module.exports = { query, withTransaction };
