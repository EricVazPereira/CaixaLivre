const express = require('express')
const cors    = require('cors')
const { query } = require('./db')
const { SERVIDOR_PORTA } = require('./config')

const produtosRouter   = require('./routes/produtos')
const contasRouter     = require('./routes/contas')
const historicoRouter  = require('./routes/historico')
const impressoraRouter = require('./routes/impressora')
const balancaRouter    = require('./routes/balanca')
const authRouter       = require('./routes/auth')

const app  = express()
const PORT = SERVIDOR_PORTA

app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
app.use(express.json())

app.use('/api/produtos',   produtosRouter)
app.use('/api/contas',     contasRouter)
app.use('/api/historico',  historicoRouter)
app.use('/api/impressora', impressoraRouter)
app.use('/api/balanca',    balancaRouter)
app.use('/api/auth',       authRouter)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ erro: 'Erro interno do servidor' })
})

/**
 * Sincroniza generators do Firebird com o MAX(ID) de cada tabela.
 * Garante que GEN_CONTA e GEN_CONSUMO nunca estejam atrás dos dados reais.
 */
async function sincronizarGenerators() {
  const [maxConta, maxConsumo, maxHistorico, genConta, genConsumo, genHistorico] = await Promise.all([
    query('SELECT MAX(ID_CONTA)      AS M FROM CONTA'),
    query('SELECT MAX(ID_CONSUMO)    AS M FROM CONSUMO'),
    query('SELECT MAX(ID_HISTORICO)  AS M FROM HISTORICO'),
    query('SELECT GEN_ID(GEN_CONTA,      0) AS G FROM RDB$DATABASE'),
    query('SELECT GEN_ID(GEN_CONSUMO,    0) AS G FROM RDB$DATABASE'),
    query('SELECT GEN_ID(GEN_HISTORICO,  0) AS G FROM RDB$DATABASE'),
  ])

  const maxC  = maxConta[0]['M']      || 0
  const maxCS = maxConsumo[0]['M']    || 0
  const maxH  = maxHistorico[0]['M']  || 0
  const genC  = genConta[0]['G']      || 0
  const genCS = genConsumo[0]['G']    || 0
  const genH  = genHistorico[0]['G']  || 0

  if (genC < maxC) {
    await query(`SET GENERATOR GEN_CONTA TO ${maxC}`)
    console.log(`🔧 GEN_CONTA ajustado: ${genC} → ${maxC}`)
  }
  if (genCS < maxCS) {
    await query(`SET GENERATOR GEN_CONSUMO TO ${maxCS}`)
    console.log(`🔧 GEN_CONSUMO ajustado: ${genCS} → ${maxCS}`)
  }
  if (genH < maxH) {
    await query(`SET GENERATOR GEN_HISTORICO TO ${maxH}`)
    console.log(`🔧 GEN_HISTORICO ajustado: ${genH} → ${maxH}`)
  }
}

/** Garante que a estação CAIXALIVRE-01 existe na tabela ESTACAO */
async function garantirEstacao() {
  const rows = await query(`SELECT DS_ESTACAO FROM ESTACAO WHERE DS_ESTACAO = 'CAIXALIVRE-01'`)
  if (!rows.length) {
    await query(
      `INSERT INTO ESTACAO (DS_ESTACAO, ATIVO_ESTACAO, TP_ESTACAO, INDICE_ESTACAO,
         OPERACAO_ESTACAO, PDV_ESTACAO, ST_ESTACAO, FL_TAXA_GERAL_ESTACAO, DH_MAN_ESTACAO)
       VALUES ('CAIXALIVRE-01', 1, 0, 0, 1, 1, 1, 0, CURRENT_TIMESTAMP)`
    )
    console.log('✅ Estação CAIXALIVRE-01 cadastrada no Firebird')
  }
}

Promise.all([sincronizarGenerators(), garantirEstacao()])
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Backend CaixaLivre rodando em http://localhost:${PORT}`)
      console.log(`🗄️  Banco: Firebird — ORESTRA.FDB`)
    })
  })
  .catch(err => {
    console.error('❌ Falha ao conectar ao Firebird:', err.message)
    process.exit(1)
  })
