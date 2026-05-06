/**
 * agente.js — Processo local do totem
 *
 * Roda na máquina onde a balança está conectada.
 * Expõe apenas /api/balanca — sem Firebird, sem ERP.
 *
 * O servidor central (server.js) pode estar em qualquer máquina da rede.
 * Para mover o servidor, basta alterar [Servidor] Endereco no Network.ini.
 * A porta deste agente é configurada em [Agente] Porta no Network.ini.
 */

const express       = require('express')
const cors          = require('cors')
const { AGENTE_PORTA } = require('./config')
const balancaRouter = require('./routes/balanca')

const app = express()

app.use(cors({ origin: '*' }))   // totem local — acesso só da própria máquina
app.use(express.json())

app.use('/api/balanca', balancaRouter)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ erro: 'Erro interno do agente' })
})

app.listen(AGENTE_PORTA, 'localhost', () => {
  console.log(`✅ Agente local CaixaLivre rodando em http://localhost:${AGENTE_PORTA}`)
  console.log(`   Balança: /api/balanca/*`)
})
