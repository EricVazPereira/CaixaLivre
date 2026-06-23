'use strict'
/**
 * balanca-totem.js — Balança dedicada para pesagem de produtos pelo cliente.
 * Configuração separada: seção [BalancaPesagem] no Network.ini
 * Exemplo:
 *   [BalancaPesagem]
 *   Habilitar=SIM
 *   Porta=COM8
 *   BaudRate=9600
 *   DataBits=8
 *   Parity=none
 *   StopBits=1
 */

const { Router }   = require('express')
const EventEmitter = require('events')
const fs           = require('fs')
const path         = require('path')

let SerialPort = null
try {
  SerialPort = require('serialport').SerialPort
} catch (e) {
  console.warn('[balanca-totem] serialport indisponível — balança do totem desabilitada.')
}

const router = Router()

const ENQ            = Buffer.from([0x05])
const STX            = 0x02
const ETX            = 0x03
const POLL_INTERVALO = 300

// ── Configuração via Network.ini ─────────────────────────────────────────────

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
  } catch {
    return {}
  }
}

const INI_PATH = process.env.CAIXALIVRE_INI || path.resolve(__dirname, '../../../Network.ini')
const cfg      = lerSecaoIni(INI_PATH, 'BalancaPesagem')

const HABILITADA = (cfg['Habilitar'] || 'NAO').trim().toUpperCase() === 'SIM'
const PORTA      = cfg['Porta']    || 'COM8'
const BAUD       = parseInt(cfg['BaudRate'],  10) || 9600
const DATA       = parseInt(cfg['DataBits'],  10) || 8
const PARITY     = (cfg['Parity']  || 'none').toLowerCase()
const STOP       = parseFloat(cfg['StopBits']) || 1

console.log(`[balanca-totem] Habilitar=${HABILITADA ? 'SIM' : 'NÃO'}`)
if (HABILITADA) console.log(`[balanca-totem] ${PORTA} | ${BAUD} bps | ${DATA}${PARITY[0].toUpperCase()}${STOP}`)

// ── Frame parser ─────────────────────────────────────────────────────────────

function classificarPayload(raw) {
  const s = raw.toString('ascii')
  if (/^\d+$/.test(s)) {
    const peso = parseInt(s, 10)
    return peso === 0 ? { tipo: 'vazio', peso: 0 } : { tipo: 'ok', peso }
  }
  if (/^[N\s]+$/i.test(s))          return { tipo: 'vazio',    peso: 0 }
  if (/^[IMUSW\-\+\s]+$/i.test(s)) return { tipo: 'instavel', peso: 0 }
  return { tipo: 'invalido', peso: 0 }
}

// ── PortManager (mesmo padrão da balança principal) ──────────────────────────

class PortManager extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(30)
    this.port         = null
    this.ready        = false
    this.buffer       = Buffer.alloc(0)
    this._pollTimer   = null
    this._reconnTimer = null
  }

  connect() {
    if (this.ready || this._reconnTimer) return
    if (!SerialPort) return

    let port
    try {
      port = new SerialPort({ path: PORTA, baudRate: BAUD, dataBits: DATA, parity: PARITY, stopBits: STOP, autoOpen: false })
    } catch (e) {
      console.error('[balanca-totem] Não foi possível criar porta serial:', e.message)
      this._scheduleReconnect(); return
    }

    this.port = port

    port.open(err => {
      if (err) {
        const m = err.message?.toLowerCase() || ''
        if (m.includes('file not found') || m.includes('cannot open')) {
          console.error(`[balanca-totem] ❌ Porta ${PORTA} não encontrada.`)
          this._scheduleReconnect(30_000)
        } else {
          console.error(`[balanca-totem] Não foi possível abrir ${PORTA}:`, err.message)
          this._scheduleReconnect()
        }
        return
      }
      this.ready  = true
      this.buffer = Buffer.alloc(0)
      console.log(`[balanca-totem] ✅ Porta ${PORTA} aberta`)
      this._startPoll()
    })

    port.on('error', () => this._handleDisconnect())
    port.on('close', () => { if (this.ready) this._handleDisconnect() })
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
    clearInterval(this._pollTimer); this._pollTimer = null
    this.emit('disconnect')
    try { this.port?.isOpen && this.port.close() } catch (_) {}
    this._scheduleReconnect()
  }

  _scheduleReconnect(delayMs = 5000) {
    if (this._reconnTimer) return
    this._reconnTimer = setTimeout(() => { this._reconnTimer = null; this.connect() }, delayMs)
  }

  close() {
    clearInterval(this._pollTimer); clearTimeout(this._reconnTimer)
    this.ready = false
    try { this.port?.isOpen && this.port.close() } catch (_) {}
  }
}

const portManager = HABILITADA ? new PortManager() : null
if (portManager) portManager.connect()

// ── Leitura de peso estável ───────────────────────────────────────────────────

function lerPesoEstavel(timeoutMs = 6000, estabilidadeMs = 1200) {
  return new Promise(resolve => {
    if (!portManager?.ready) return resolve({ ok: false, sem_comunicacao: true })

    let done       = false
    let ultimoPeso = null
    let estabTimer = null

    const globalTimer = setTimeout(() => {
      if (ultimoPeso !== null) finish({ ok: true, peso_gramas: ultimoPeso })
      else finish({ ok: false, sem_comunicacao: true })
    }, timeoutMs)

    function onFrame({ tipo, peso }) {
      if (tipo === 'instavel') { clearTimeout(estabTimer); return }
      if (tipo !== 'ok' && tipo !== 'vazio') return
      if (ultimoPeso === null || Math.abs(peso - ultimoPeso) > 20) {
        ultimoPeso = peso
        clearTimeout(estabTimer)
        estabTimer = setTimeout(() => finish({ ok: true, peso_gramas: ultimoPeso }), estabilidadeMs)
      }
    }
    function onDisconnect() { finish({ ok: false, sem_comunicacao: true }) }

    function finish(result) {
      if (done) return
      done = true
      clearTimeout(globalTimer); clearTimeout(estabTimer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      resolve(result)
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

/** Leitura instantânea (polling contínuo — retorna o frame mais recente estável) */
function lerPesoAtual() {
  return new Promise((resolve, reject) => {
    if (!portManager?.ready) return reject(new Error('Balança do totem não conectada'))

    let done  = false
    const timer = setTimeout(() => finish(null, new Error('Sem resposta em 3s')), 3000)

    function onFrame({ tipo, peso }) {
      if (tipo === 'ok' || tipo === 'vazio') finish({ peso_gramas: peso })
    }
    function onDisconnect() { finish(null, new Error('Conexão perdida')) }

    function finish(result, err) {
      if (done) return; done = true
      clearTimeout(timer)
      portManager.removeListener('frame', onFrame)
      portManager.removeListener('disconnect', onDisconnect)
      err ? reject(err) : resolve(result)
    }

    portManager.on('frame', onFrame)
    portManager.once('disconnect', onDisconnect)
  })
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

router.get('/config', (_req, res) => {
  res.json({ habilitada: HABILITADA, porta: PORTA, baudRate: BAUD, pronto: portManager?.ready ?? false })
})

router.get('/peso', async (_req, res) => {
  if (!HABILITADA) return res.json({ ok: true, desabilitada: true, peso_gramas: 0 })
  try {
    const r = await lerPesoAtual()
    res.json({ ok: true, peso_gramas: r.peso_gramas })
  } catch (e) {
    res.status(503).json({ ok: false, erro: e.message })
  }
})

router.get('/peso-estavel', async (req, res) => {
  if (!HABILITADA) return res.json({ ok: true, desabilitada: true, peso_gramas: 0 })
  const timeoutMs      = parseInt(req.query.timeout,      10) || 6000
  const estabilidadeMs = parseInt(req.query.estabilidade, 10) || 1200
  const resultado = await lerPesoEstavel(timeoutMs, estabilidadeMs)
  res.json(resultado)
})

module.exports = { router, portManager }
