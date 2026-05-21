const { Router }   = require('express')
const EventEmitter = require('events')
const fs           = require('fs')
const path         = require('path')

// Carrega serialport com proteção para quando o módulo não está compilado
// para a versão do Node embutida no Electron (requer electron:rebuild antes do pack)
let SerialPort = null
try {
  SerialPort = require('serialport').SerialPort
} catch (e) {
  console.warn('[balanca] serialport indisponível — balança desabilitada nesta sessão.')
  console.warn('[balanca] Causa:', e.message)
  console.warn('[balanca] Execute "npm run electron:rebuild" antes de empacotar.')
}

const router = Router()

const ENQ            = Buffer.from([0x05])
const STX            = 0x02
const ETX            = 0x03
const POLL_INTERVALO = 300   // ms entre ENQs

// ── Lê configuração do Network.ini ───────────────────────────────────────────

function lerSecaoIni(caminhoArquivo, secao) {
  try {
    const linhas   = fs.readFileSync(caminhoArquivo, 'utf-8').split(/\r?\n/)
    let dentro     = false
    const resultado = {}
    for (const linha of linhas) {
      const t = linha.trim()
      if (!t || t.startsWith(';') || t.startsWith('#')) continue
      if (t.startsWith('[')) { dentro = t.toLowerCase() === `[${secao.toLowerCase()}]`; continue }
      if (dentro) {
        const [k, ...v] = t.split('=')
        if (k && v.length) resultado[k.trim()] = v.join('=').trim()
      }
    }
    return resultado
  } catch (e) {
    console.warn('[balanca] Não foi possível ler Network.ini:', e.message)
    return {}
  }
}

// Em modo Electron, main.cjs define CAIXALIVRE_INI com o caminho correto
// Em modo standalone (node src/agente.js), usa caminho relativo à raiz do projeto
const INI_PATH = process.env.CAIXALIVRE_INI || path.resolve(__dirname, '../../../Network.ini')
const cfg      = lerSecaoIni(INI_PATH, 'Balanca')

const HABILITADA = (cfg['Habilitar'] || 'SIM').trim().toUpperCase() === 'SIM'
const PORTA      = cfg['Porta']    || 'COM7'
const BAUD       = parseInt(cfg['BaudRate'],  10) || 9600
const DATA       = parseInt(cfg['DataBits'],  10) || 8
const PARITY     = (cfg['Parity']  || 'none').toLowerCase()
const STOP       = parseFloat(cfg['StopBits']) || 1

console.log(`[balanca] Habilitar=${HABILITADA ? 'SIM' : 'NÃO'}`)
if (HABILITADA) console.log(`[balanca] ${PORTA} | ${BAUD} bps | ${DATA}${PARITY[0].toUpperCase()}${STOP}`)

const SERIAL_OPTS = { path: PORTA, baudRate: BAUD, dataBits: DATA, parity: PARITY, stopBits: STOP, autoOpen: false }

// ── Classificação de frames ──────────────────────────────────────────────────

function classificarPayload(raw) {
  const s = raw.toString('ascii')
  if (/^\d+$/.test(s)) {
    const peso = parseInt(s, 10)
    return peso === 0 ? { tipo: 'vazio', peso: 0 } : { tipo: 'ok', peso }
  }
  if (/^[N\s]+$/i.test(s))           return { tipo: 'vazio',    peso: 0 }
  if (/^[IMUSW\-\+\s]+$/i.test(s))  return { tipo: 'instavel', peso: 0 }
  return { tipo: 'invalido', peso: 0 }
}

// ── PortManager: porta serial persistente ────────────────────────────────────
//
// Abre a porta uma vez, mantém poll contínuo de ENQ e emite evento 'frame'
// para cada pacote recebido. Handlers de rota apenas escutam esses eventos —
// nunca abrem/fecham a porta por conta própria.
//
// Isso evita o problema do Windows de porta "travada" após fechamento abrupto
// (causado por reinicialização do node --watch no meio de uma operação).

class PortManager extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
    this.port          = null
    this.ready         = false
    this.buffer        = Buffer.alloc(0)
    this._pollTimer    = null
    this._reconnTimer  = null
  }

  connect() {
    if (this.ready || this._reconnTimer) return
    clearTimeout(this._reconnTimer)
    this._reconnTimer = null

    // Se serialport não carregou (ABI incompatível / rebuild pendente), abandona silenciosamente
    if (!SerialPort) {
      console.warn('[balanca] SerialPort não disponível — pulando reconexão.')
      return
    }

    let port
    try {
      port = new SerialPort(SERIAL_OPTS)
    } catch (e) {
      console.error('[balanca] Não foi possível criar porta serial:', e.message)
      this._scheduleReconnect()
      return
    }

    this.port = port

    port.open(err => {
      if (err) {
        const motivo = err.message?.toLowerCase() || ''
        if (motivo.includes('file not found') || motivo.includes('cannot open') || motivo.includes('não encontrad')) {
          // Porta não existe na máquina — inútil ficar tentando; aguarda 30s
          console.error(`[balanca] ❌ Porta ${PORTA} não encontrada. Verifique o Network.ini e o cabo da balança.`)
          this._scheduleReconnect(30_000)
        } else if (motivo.includes('access denied') || motivo.includes('acesso negado')) {
          console.error(`[balanca] Acesso negado à ${PORTA} — outro processo pode estar usando a porta. Tentando em 8s...`)
          this._scheduleReconnect(8000)
        } else {
          console.error(`[balanca] Não foi possível abrir ${PORTA}:`, err.message)
          this._scheduleReconnect()
        }
        return
      }
      this.ready  = true
      this.buffer = Buffer.alloc(0)
      console.log(`[balanca] ✅ Porta ${PORTA} aberta — polling a cada ${POLL_INTERVALO}ms`)
      this._startPoll()
    })

    port.on('error', e => {
      console.error('[balanca] Erro serial:', e.message)
      this._handleDisconnect()
    })

    port.on('close', () => {
      if (this.ready) {
        console.warn('[balanca] Porta fechada inesperadamente — reconectando...')
        this._handleDisconnect()
      }
    })

    port.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      while (true) {
        const si = this.buffer.indexOf(STX)
        const ei = this.buffer.indexOf(ETX, si + 1)
        if (si === -1 || ei === -1) break
        if (ei - si - 1 !== 5) { this.buffer = this.buffer.slice(ei + 1); continue }
        const payload = this.buffer.slice(si + 1, ei)
        this.buffer   = this.buffer.slice(ei + 1)
        this.emit('frame', classificarPayload(payload))
      }
    })
  }

  _startPoll() {
    clearInterval(this._pollTimer)
    this._writeENQ()
    this._pollTimer = setInterval(() => this._writeENQ(), POLL_INTERVALO)
  }

  _writeENQ() {
    if (this.ready && this.port?.isOpen) this.port.write(ENQ)
  }

  _handleDisconnect() {
    this.ready = false
    clearInterval(this._pollTimer)
    this._pollTimer = null
    this.emit('disconnect')
    try { this.port?.isOpen && this.port.close() } catch (_) {}
    this._scheduleReconnect()
  }

  _scheduleReconnect(delayMs = 3000) {
    if (this._reconnTimer) return
    console.log(`[balanca] Reconectando em ${delayMs / 1000}s...`)
    this._reconnTimer = setTimeout(() => {
      this._reconnTimer = null
      this.connect()
    }, delayMs)
  }

  /**
   * Força reconexão imediata — cancela timer pendente e chama connect().
   * No-op se já estiver conectado.
   * Chamado pelo frontend ao montar a tela de operação após um fluxo de liberação.
   */
  reconnect() {
    if (this.ready) return
    if (this._reconnTimer) {
      clearTimeout(this._reconnTimer)
      this._reconnTimer = null
    }
    console.log('[balanca] Reconexão forçada pelo frontend.')
    this.connect()
  }

  /** Fecha a porta limpo — chamado no shutdown do agente */
  close() {
    clearInterval(this._pollTimer)
    clearTimeout(this._reconnTimer)
    this.ready = false
    try { this.port?.isOpen && this.port.close() } catch (_) {}
    console.log('[balanca] Porta serial fechada')
  }
}

const portManager = HABILITADA ? new PortManager() : null
if (portManager) portManager.connect()

// ── Funções de leitura (compartilham a porta persistente) ────────────────────

/** Verifica se a balança está respondendo (abertura de caixa) */
function testarComunicacao() {
  return new Promise(resolve => {
    if (!portManager?.ready) return resolve({ ok: false })

    let done = false
    const timer = setTimeout(() => finish(false), 3000)

    function onFrame({ tipo }) {
      if (tipo === 'ok' || tipo === 'vazio') finish(true)
    }
    function onDisconnect() { finish(false) }

    function finish(ok) {
      if (done) return
      done = true
      clearTimeout(timer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      resolve({ ok })
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

/** Lê o peso atual uma única vez */
function lerPeso() {
  return new Promise((resolve, reject) => {
    if (!portManager?.ready) return reject(new Error('Balança não conectada'))

    let done = false
    const timer = setTimeout(() => finish(null, new Error('Balança não respondeu em 5s')), 5000)

    function onFrame({ tipo, peso }) {
      if (tipo === 'ok') finish({ peso_gramas: peso, tentativas: 1 })
    }
    function onDisconnect() { finish(null, new Error('Conexão perdida com a balança')) }

    function finish(result, err) {
      if (done) return
      done = true
      clearTimeout(timer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      err ? reject(err) : resolve(result)
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

/** Lê o peso aguardando estabilidade (check do pagamento) */
function lerPesoEstavel(timeoutMs = 5000, estabilidadeMs = 1000) {
  return new Promise(resolve => {
    if (!portManager?.ready) return resolve({ ok: false, sem_comunicacao: true })

    let done             = false
    let ultimoPeso       = null
    let ultimoAtualizado = 0    // timestamp da última atualização de ultimoPeso
    let estabTimer       = null

    // Se o timeout global disparar antes da estabilização:
    //   - peso atualizado há menos de (timeoutMs/2) ms → aceita (scale oscilando mas dentro da janela)
    //   - peso antigo ou nunca recebido → balança instável, bloqueia
    const globalTimer = setTimeout(() => {
      const idadeMs = Date.now() - ultimoAtualizado
      if (ultimoPeso !== null && idadeMs < timeoutMs / 2) {
        finish({ ok: true, peso_gramas: ultimoPeso })
      } else {
        finish({ ok: false, sem_comunicacao: true })
      }
    }, timeoutMs)

    function onFrame({ tipo, peso }) {
      if (tipo === 'instavel') { clearTimeout(estabTimer); return }
      if (tipo !== 'ok' && tipo !== 'vazio') return
      if (ultimoPeso === null || Math.abs(peso - ultimoPeso) > 50) {
        ultimoPeso       = peso
        ultimoAtualizado = Date.now()
        clearTimeout(estabTimer)
        estabTimer = setTimeout(() => finish({ ok: true, peso_gramas: ultimoPeso }), estabilidadeMs)
      }
    }
    function onDisconnect() { finish({ ok: false, sem_comunicacao: true }) }

    function finish(result) {
      if (done) return
      done = true
      clearTimeout(globalTimer)
      clearTimeout(estabTimer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      resolve(result)
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

/**
 * Aguarda o produto ser colocado na balança (delta sobre o baseline).
 * Cada produto é conferido individualmente.
 */
function aguardarDelta(delta, tolerancia, timeoutMs) {
  return new Promise(resolve => {
    if (!portManager?.ready) return resolve({ ok: false, sem_comunicacao: true })

    let done            = false
    let baseline        = null
    let algoPesadoVisto = false
    let baselineTimer   = null

    const globalTimer = setTimeout(() => {
      finish(algoPesadoVisto
        ? { ok: false, divergencia: true }
        : { ok: false, sem_peso: true })
    }, timeoutMs)

    // Se baseline não chegar em 3s, assume 0g e continua
    baselineTimer = setTimeout(() => {
      if (baseline === null) {
        console.warn('[balanca/aguardar] baseline não capturado em 3s, assumindo 0g')
        baseline = 0
        console.log(`[balanca/aguardar] baseline: 0g | alvo: ${delta}g (±${(tolerancia * 100).toFixed(0)}%)`)
      }
    }, 3000)

    function onFrame({ tipo, peso }) {
      // Fase 1: capturar baseline
      if (baseline === null) {
        if (tipo === 'ok' || tipo === 'vazio') {
          baseline = peso
          clearTimeout(baselineTimer)
          console.log(`[balanca/aguardar] baseline: ${baseline}g | alvo: ${baseline + delta}g (±${(tolerancia * 100).toFixed(0)}%)`)
        }
        return
      }

      // Fase 2: conferir adição do produto
      if (tipo !== 'ok') return

      const alvo   = baseline + delta
      const adicao = peso - baseline
      const diff   = Math.abs(peso - alvo) / alvo

      console.log(`[balanca/aguardar] lido: ${peso}g | baseline: ${baseline}g | adição: ${adicao}g | alvo: ${alvo}g | diff: ${(diff * 100).toFixed(1)}%`)

      if (adicao > 30) algoPesadoVisto = true

      if (diff <= tolerancia) return finish({ ok: true, peso_gramas: peso })

      if (adicao > 30) {
        console.warn(`[balanca/aguardar] divergência: ${peso}g vs alvo ${alvo}g (${(diff * 100).toFixed(1)}%)`)
        return finish({ ok: false, divergencia: true, peso_gramas: peso })
      }
    }

    function onDisconnect() { finish({ ok: false, sem_comunicacao: true }) }

    function finish(result) {
      if (done) return
      done = true
      clearTimeout(globalTimer)
      clearTimeout(baselineTimer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      resolve(result)
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

/**
 * Mede o peso do próximo item colocado (para produtos sem FORMATO_PRO).
 * Aguarda estabilidade após a adição.
 */
function medirPeso(timeoutMs, estabilidadeMs = 1000) {
  return new Promise(resolve => {
    if (!portManager?.ready) return resolve({ ok: false, sem_comunicacao: true })

    let done          = false
    let baseline      = null
    let ultimoPeso    = null
    let estabTimer    = null
    let baselineTimer = null

    const globalTimer = setTimeout(() => {
      if (ultimoPeso !== null && ultimoPeso - baseline > 30) confirmarPeso()
      else finish({ ok: false, sem_peso: true })
    }, timeoutMs)

    baselineTimer = setTimeout(() => {
      if (baseline === null) {
        console.warn('[balanca/medir] baseline não capturado em 3s, assumindo 0g')
        baseline = 0
      }
    }, 3000)

    function confirmarPeso() {
      const adicao = ultimoPeso - baseline
      console.log(`[balanca/medir] estabilizado: ${ultimoPeso}g | baseline: ${baseline}g | delta: ${adicao}g`)
      finish({ ok: true, peso_gramas: adicao, peso_absoluto: ultimoPeso })
    }

    function reiniciarEstabilidade(pesoAtual) {
      ultimoPeso = pesoAtual
      clearTimeout(estabTimer)
      estabTimer = setTimeout(confirmarPeso, estabilidadeMs)
      console.log(`[balanca/medir] leitura: ${pesoAtual}g — aguardando ${estabilidadeMs / 1000}s de estabilidade…`)
    }

    function onFrame({ tipo, peso }) {
      if (baseline === null) {
        if (tipo === 'ok' || tipo === 'vazio') {
          baseline = peso
          clearTimeout(baselineTimer)
          console.log(`[balanca/medir] baseline: ${baseline}g`)
        }
        return
      }

      if (tipo === 'instavel') {
        if (ultimoPeso !== null) {
          clearTimeout(estabTimer)
          console.log('[balanca/medir] instável — aguardando…')
        }
        return
      }

      if (tipo !== 'ok') return

      const adicao = peso - baseline
      if (adicao <= 30) {
        if (ultimoPeso !== null) {
          ultimoPeso = null
          clearTimeout(estabTimer)
          console.log('[balanca/medir] peso removido — aguardando novo item…')
        }
        return
      }

      if (ultimoPeso === null) {
        reiniciarEstabilidade(peso)
      } else if (Math.abs(peso - ultimoPeso) > 50) {
        reiniciarEstabilidade(peso)
      }
    }

    function onDisconnect() { finish({ ok: false, sem_comunicacao: true }) }

    function finish(result) {
      if (done) return
      done = true
      clearTimeout(globalTimer)
      clearTimeout(baselineTimer)
      clearTimeout(estabTimer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      resolve(result)
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

// ── Rotas ────────────────────────────────────────────────────────────────────

router.get('/config', (_req, res) => {
  res.json({ habilitada: HABILITADA, porta: PORTA, baudRate: BAUD })
})

/**
 * POST /api/balanca/reconectar
 * Cancela qualquer timer de reconexão pendente e tenta conectar imediatamente.
 * Chamado pelo frontend ao montar a tela de produtos após fluxo de liberação.
 */
router.post('/reconectar', (_req, res) => {
  if (!portManager) return res.json({ ok: false, habilitada: false })
  portManager.reconnect()
  res.json({ ok: true, ready: portManager.ready })
})

router.get('/teste', async (_req, res) => {
  if (!HABILITADA) return res.json({ ok: true, habilitada: false })
  const resultado = await testarComunicacao()
  console.log(`[balanca] Teste de comunicação: ${resultado.ok ? '✅ OK' : '❌ Sem resposta'}`)
  res.json({ ...resultado, habilitada: true })
})

router.get('/peso-estavel', async (req, res) => {
  const timeoutMs      = parseInt(req.query.timeout,      10) || 5000
  const estabilidadeMs = parseInt(req.query.estabilidade, 10) || 2000
  if (!HABILITADA) return res.json({ ok: true, desabilitada: true, peso_gramas: 0 })
  const resultado = await lerPesoEstavel(timeoutMs, estabilidadeMs)
  res.json(resultado)
})

router.get('/peso', async (_req, res) => {
  try {
    const r = await lerPeso()
    console.log(`[balanca] Peso lido: ${r.peso_gramas}g`)
    res.json({ ok: true, peso_gramas: r.peso_gramas })
  } catch (e) {
    console.error('[balanca] GET /peso —', e.message)
    res.status(503).json({ ok: false, erro: e.message })
  }
})

router.get('/aguardar', async (req, res) => {
  const delta      = parseInt(req.query.delta,      10)
  const tolerancia = parseInt(req.query.tolerancia, 10) / 100 || 0.15
  const timeoutMs  = parseInt(req.query.timeout,    10) || 12000

  if (!HABILITADA) return res.json({ ok: true, desabilitada: true })

  if (!delta || delta <= 0) {
    return res.json({ ok: false, sem_peso: true, erro: 'Parâmetro "delta" inválido.' })
  }

  const resultado = await aguardarDelta(delta, tolerancia, timeoutMs)
  res.json(resultado)
})

router.get('/medir', async (req, res) => {
  const timeoutMs      = parseInt(req.query.timeout,      10) || 15000
  const estabilidadeMs = parseInt(req.query.estabilidade, 10) || 1000
  if (!HABILITADA) return res.json({ ok: true, desabilitada: true })
  const resultado = await medirPeso(timeoutMs, estabilidadeMs)
  console.log(`[balanca] /medir (estab=${estabilidadeMs}ms) →`, resultado)
  res.json(resultado)
})

module.exports = { router, portManager }
