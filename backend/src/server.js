'use strict'
const express = require('express')
const cors    = require('cors')
const http    = require('http')
const path    = require('path')
const fs      = require('fs')
const { SERVIDOR_PORTA, AGENTE_PORTA, NM_ESTACAO } = require('./config')

const produtosRouter   = require('./routes/produtos')
const pesagemRouter    = require('./routes/pesagem')
const contasRouter     = require('./routes/contas')
const historicoRouter  = require('./routes/historico')
const impressoraRouter = require('./routes/impressora')
const authRouter       = require('./routes/auth')
const sitefRouter      = require('./routes/sitef')
const configRouter     = require('./routes/config')

const app  = express()
const PORT = SERVIDOR_PORTA

app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
app.use(express.json())

// Health-check — usado pelo Electron para saber que o servidor está pronto
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// /api/balanca/* e /api/balanca-totem/* → proxy para o agente local
function proxyAgente(prefixo) {
  return (req, res) => {
    const proxyReq = http.request(
      {
        hostname: 'localhost',
        port:     AGENTE_PORTA,
        path:     prefixo + req.url,
        method:   req.method,
        headers:  { ...req.headers, host: `localhost:${AGENTE_PORTA}` },
      },
      proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(res)
      }
    )
    proxyReq.on('error', () => {
      if (!res.headersSent)
        res.status(503).json({ ok: false, habilitada: false, erro: 'Agente não disponível' })
    })
    if (req.method === 'POST') req.pipe(proxyReq)
    else proxyReq.end()
  }
}

app.use('/api/balanca-totem', proxyAgente('/api/balanca-totem'))

app.use('/api/balanca', proxyAgente('/api/balanca'))

app.use('/api/produtos',   produtosRouter)
app.use('/api/contas',     contasRouter)
app.use('/api/historico',  historicoRouter)
app.use('/api/impressora', impressoraRouter)
app.use('/api/auth',       authRouter)
app.use('/api/sitef',      sitefRouter)
app.use('/api/config',     configRouter)
app.use('/api/pesagem',    pesagemRouter)

// Imagens do cliente — servidas de \img\ ao lado do executável
// Permite trocar logo.bmp sem recompilar o app
const IMG_DIR = process.env.CAIXALIVRE_IMG || path.resolve(__dirname, '../../img')
app.use('/img', express.static(IMG_DIR))

// Frontend estático compilado (Electron / produção)
// Em dev:  CAIXALIVRE_DIST não definido → tenta ../../dist (raiz do projeto)
// Em prod: CAIXALIVRE_DIST definido pelo Electron → resources/dist/
const DIST_DIR = process.env.CAIXALIVRE_DIST || path.resolve(__dirname, '../../dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA fallback — qualquer rota não-API devolve o index.html do React
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ erro: 'Erro interno do servidor' })
})

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicia o servidor após sincronizar o Firebird.
 * Retorna o http.Server quando a porta estiver pronta.
 * Usado pelo Electron (main.cjs) para controlar o ciclo de vida.
 */
async function start() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`✅ Backend CaixaLivre rodando em http://localhost:${PORT}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}

// ── Modo standalone (node src/server.js) ─────────────────────────────────────
if (require.main === module) {
  start()
    .then(server => {
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Porta ${PORT} em uso — tentando de novo em 1s...`)
          setTimeout(() => { server.close(); server.listen(PORT) }, 1000)
        } else {
          throw err
        }
      })

      function shutdown(signal) {
        console.log(`\n🛑 ${signal} recebido — encerrando servidor...`)
        server.close(() => {
          console.log('✅ Servidor encerrado')
          process.exit(0)
        })
        setTimeout(() => process.exit(0), 3000).unref()
      }

      process.on('SIGTERM', () => shutdown('SIGTERM'))
      process.on('SIGINT',  () => shutdown('SIGINT'))
    })
    .catch(err => {
      console.error('❌ Falha ao conectar ao Firebird:', err.message)
      process.exit(1)
    })
}

module.exports = { start, app }
