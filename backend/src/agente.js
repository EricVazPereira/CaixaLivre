'use strict'
/**
 * agente.js — Processo local do totem
 *
 * Roda na máquina onde a balança está conectada.
 * Expõe apenas /api/balanca — sem Firebird, sem ERP.
 *
 * Em modo Electron:  carregado pelo main.cjs via require(), retorna start()
 * Em modo standalone: node src/agente.js
 */

const express       = require('express')
const cors          = require('cors')
const { AGENTE_PORTA }                       = require('./config')
const { router: balancaRouter, portManager } = require('./routes/balanca')

const app = express()

app.use(cors({ origin: '*' }))   // totem local — acesso só da própria máquina
app.use(express.json())

// Health-check — usado pelo Electron para saber que o agente está pronto
app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api/balanca', balancaRouter)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ erro: 'Erro interno do agente' })
})

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicia o agente.
 * Retorna { server, portManager } quando a porta estiver pronta.
 * Usado pelo Electron (main.cjs) para controlar o ciclo de vida.
 */
async function start() {
  return new Promise((resolve, reject) => {
    const server = app.listen(AGENTE_PORTA, 'localhost', () => {
      console.log(`✅ Agente local CaixaLivre rodando em http://localhost:${AGENTE_PORTA}`)
      resolve({ server, portManager })
    })
    server.on('error', reject)
  })
}

// ── Modo standalone (node src/agente.js) ─────────────────────────────────────
if (require.main === module) {
  start()
    .then(({ server, portManager }) => {
      function shutdown(signal) {
        console.log(`\n🛑 ${signal} recebido — encerrando agente...`)
        if (portManager) portManager.close()
        server.close(() => {
          console.log('✅ Agente encerrado')
          process.exit(0)
        })
        setTimeout(() => process.exit(0), 3000).unref()
      }

      process.on('SIGTERM', () => shutdown('SIGTERM'))
      process.on('SIGINT',  () => shutdown('SIGINT'))
    })
    .catch(err => {
      console.error('❌ Falha ao iniciar agente:', err.message)
      process.exit(1)
    })
}

module.exports = { start }
