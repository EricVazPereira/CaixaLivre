const { Router }     = require('express')
const { SerialPort } = require('serialport')
const fs             = require('fs')
const path           = require('path')

const router = Router()

const ENQ            = Buffer.from([0x05])
const STX            = 0x02
const ETX            = 0x03
const TIMEOUT_MS     = 5000
const POLL_INTERVALO = 300

/**
 * Lê uma seção do Network.ini e retorna um objeto { chave: valor }.
 * Parser simples — não depende de pacotes externos.
 */
function lerSecaoIni(caminhoArquivo, secao) {
  try {
    const conteudo = fs.readFileSync(caminhoArquivo, 'utf-8')
    const linhas   = conteudo.split(/\r?\n/)
    let dentroSecao = false
    const resultado = {}
    for (const linha of linhas) {
      const trimada = linha.trim()
      if (!trimada || trimada.startsWith(';') || trimada.startsWith('#')) continue
      if (trimada.startsWith('[')) {
        dentroSecao = trimada.toLowerCase() === `[${secao.toLowerCase()}]`
        continue
      }
      if (dentroSecao) {
        const [chave, ...resto] = trimada.split('=')
        if (chave && resto.length) resultado[chave.trim()] = resto.join('=').trim()
      }
    }
    return resultado
  } catch (e) {
    console.warn('[balanca] Não foi possível ler Network.ini:', e.message)
    return {}
  }
}

const INI_PATH = path.resolve(__dirname, '../../../Network.ini')
const cfg      = lerSecaoIni(INI_PATH, 'Balanca')

/** Lido uma vez na inicialização. Para mudar, reiniciar o backend. */
const HABILITADA = (cfg['Habilitar'] || 'SIM').trim().toUpperCase() === 'SIM'
console.log(`[balanca] Habilitar=${HABILITADA ? 'SIM' : 'NÃO'}`)

const PORTA      = cfg['Porta']    || 'COM7'
const BAUD       = parseInt(cfg['BaudRate'],  10) || 9600
const DATA       = parseInt(cfg['DataBits'],  10) || 8
const PARITY     = (cfg['Parity']  || 'none').toLowerCase()
const STOP       = parseFloat(cfg['StopBits']) || 1

if (HABILITADA) {
  console.log(`[balanca] ${PORTA} | ${BAUD} bps | ${DATA}${PARITY[0].toUpperCase()}${STOP}`)
}

/** Opções de porta serial lidas do Network.ini */
const SERIAL_OPTS = { path: PORTA, baudRate: BAUD, dataBits: DATA, parity: PARITY, stopBits: STOP, autoOpen: false }

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

/** Lê o peso atual uma única vez. Resolve com { peso_gramas, tentativas } ou rejeita. */
function lerPeso() {
  return new Promise((resolve, reject) => {
    let port, timer, pollTimer
    let buffer     = Buffer.alloc(0)
    let tentativas = 0
    let encerrado  = false

    function encerrar(err, res) {
      if (encerrado) return
      encerrado = true
      clearTimeout(timer)
      clearInterval(pollTimer)
      try { port?.isOpen && port.close() } catch (_) {}
      err ? reject(err) : resolve(res)
    }

    try {
      port = new SerialPort(SERIAL_OPTS)
    } catch (e) { return reject(new Error('Erro ao criar porta serial: ' + e.message)) }

    port.open(err => {
      if (err) return reject(new Error('Não foi possível abrir ' + PORTA + ': ' + err.message))
      timer = setTimeout(() => encerrar(new Error(`Balança não respondeu em ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      port.on('error', e => encerrar(new Error('Erro serial: ' + e.message)))
      port.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk])
        while (!encerrado) {
          const stxPos = buffer.indexOf(STX)
          const etxPos = buffer.indexOf(ETX, stxPos + 1)
          if (stxPos === -1 || etxPos === -1) break
          const len = etxPos - stxPos - 1
          if (len !== 5) { buffer = buffer.slice(etxPos + 1); continue }
          const payload = buffer.slice(stxPos + 1, etxPos)
          buffer = buffer.slice(etxPos + 1)
          tentativas++
          const { tipo, peso } = classificarPayload(payload)
          console.log(`[balanca] frame #${tentativas}: "${payload.toString('ascii')}" → ${tipo}`)
          if (tipo === 'ok') return encerrar(null, { peso_gramas: peso, tentativas })
        }
      })
      function enviarENQ() { if (!encerrado && port?.isOpen) port.write(ENQ) }
      setTimeout(enviarENQ, 100)
      pollTimer = setInterval(enviarENQ, POLL_INTERVALO)
    })
  })
}

/**
 * Abre a porta UMA vez, lê o baseline (o que já está na balança) e aguarda
 * o peso subir pelo valor do produto (delta). Cada produto é conferido
 * individualmente — independente do que já estava na balança antes.
 *
 * Sempre resolve:
 *   { ok: true,  peso_gramas }                    ✅ delta correto
 *   { ok: false, divergencia: true, peso_gramas } ❌ algo colocado mas peso errado
 *   { ok: false, sem_peso: true }                 ⏱ timeout sem produto colocado
 */
function aguardarDelta(delta, tolerancia, timeoutMs) {
  return new Promise((resolve) => {
    let port, timer, baselineTimer, pollTimer
    let buffer          = Buffer.alloc(0)
    let encerrado       = false
    let baseline        = null   // peso estável lido antes de o cliente colocar o produto
    // Qualquer leitura acima de baseline + 30g indica que algo foi fisicamente colocado
    let algoPesadoVisto = false

    function encerrar(resultado) {
      if (encerrado) return
      encerrado = true
      clearTimeout(timer)
      clearTimeout(baselineTimer)
      clearInterval(pollTimer)
      try { port?.isOpen && port.close() } catch (_) {}
      resolve(resultado)
    }

    function definirBaseline(peso) {
      baseline = peso
      clearTimeout(baselineTimer)
      console.log(`[balanca/aguardar] baseline: ${baseline}g | alvo: ${baseline + delta}g (±${(tolerancia * 100).toFixed(0)}%)`)
    }

    try {
      port = new SerialPort(SERIAL_OPTS)
    } catch (e) {
      console.error('[balanca/aguardar] não foi possível criar porta serial:', e.message)
      return resolve({ ok: false, sem_comunicacao: true })
    }

    port.open(err => {
      if (err) {
        console.error('[balanca/aguardar] não foi possível abrir', PORTA, ':', err.message)
        return resolve({ ok: false, sem_comunicacao: true })
      }

      // Timeout global
      timer = setTimeout(() => {
        // Se algo foi colocado com peso errado → fraude → gerente
        // Se nada foi colocado → cliente não colocou → cancela silencioso
        encerrar(algoPesadoVisto
          ? { ok: false, divergencia: true }
          : { ok: false, sem_peso: true })
      }, timeoutMs)

      // Se o baseline não chegar em 3s (balança instável), assume 0g e continua
      baselineTimer = setTimeout(() => {
        if (baseline === null) {
          console.warn('[balanca/aguardar] baseline não capturado em 3s, assumindo 0g')
          definirBaseline(0)
        }
      }, 3000)

      port.on('error', e => {
        console.error('[balanca/aguardar] erro serial:', e.message)
        encerrar({ ok: false, sem_comunicacao: true })
      })

      port.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk])
        while (!encerrado) {
          const stxPos = buffer.indexOf(STX)
          const etxPos = buffer.indexOf(ETX, stxPos + 1)
          if (stxPos === -1 || etxPos === -1) break
          const len = etxPos - stxPos - 1
          if (len !== 5) { buffer = buffer.slice(etxPos + 1); continue }
          const payload = buffer.slice(stxPos + 1, etxPos)
          buffer = buffer.slice(etxPos + 1)
          const { tipo, peso } = classificarPayload(payload)

          // ── Fase 1: capturar baseline (primeira leitura estável) ──
          if (baseline === null) {
            if (tipo === 'ok' || tipo === 'vazio') definirBaseline(peso)
            continue
          }

          // ── Fase 2: conferir adição do produto ────────────────────
          if (tipo !== 'ok') continue

          const alvo   = baseline + delta
          const adicao = peso - baseline
          const diff   = Math.abs(peso - alvo) / alvo

          console.log(`[balanca/aguardar] lido: ${peso}g | baseline: ${baseline}g | adição: ${adicao}g | alvo: ${alvo}g | diff: ${(diff * 100).toFixed(1)}%`)

          // Produto colocado = adição > 30g acima do baseline
          if (adicao > 30) algoPesadoVisto = true

          if (diff <= tolerancia) {
            // ✅ Peso correto
            return encerrar({ ok: true, peso_gramas: peso })
          }

          // ❌ Diferença > 15% E algo foi colocado → divergência imediata
          // (cobre tanto peso acima quanto abaixo do esperado)
          if (adicao > 30) {
            console.warn(`[balanca/aguardar] divergência imediata: ${peso}g vs alvo ${alvo}g (${(diff * 100).toFixed(1)}%)`)
            return encerrar({ ok: false, divergencia: true, peso_gramas: peso })
          }

          // Nada relevante na balança ainda → continua aguardando o produto
        }
      })

      function enviarENQ() { if (!encerrado && port?.isOpen) port.write(ENQ) }
      setTimeout(enviarENQ, 150)
      pollTimer = setInterval(enviarENQ, POLL_INTERVALO)
    })
  })
}

/**
 * Testa rapidamente se a balança está respondendo.
 * Abre a porta, aguarda qualquer frame estável (incluindo vazio), fecha.
 * Timeout de 3s — usado na abertura de caixa.
 * Sempre resolve: { ok: true } ou { ok: false }
 */
function testarComunicacao() {
  return new Promise((resolve) => {
    let port, timer, pollTimer
    let buffer    = Buffer.alloc(0)
    let encerrado = false

    function encerrar(ok) {
      if (encerrado) return
      encerrado = true
      clearTimeout(timer)
      clearInterval(pollTimer)
      try { port?.isOpen && port.close() } catch (_) {}
      resolve({ ok })
    }

    try {
      port = new SerialPort(SERIAL_OPTS)
    } catch (_) { return resolve({ ok: false }) }

    port.open(err => {
      if (err) return resolve({ ok: false })

      timer = setTimeout(() => encerrar(false), 3000)
      port.on('error', () => encerrar(false))

      port.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk])
        while (!encerrado) {
          const stxPos = buffer.indexOf(STX)
          const etxPos = buffer.indexOf(ETX, stxPos + 1)
          if (stxPos === -1 || etxPos === -1) break
          const len = etxPos - stxPos - 1
          if (len !== 5) { buffer = buffer.slice(etxPos + 1); continue }
          const payload = buffer.slice(stxPos + 1, etxPos)
          buffer = buffer.slice(etxPos + 1)
          const { tipo } = classificarPayload(payload)
          if (tipo === 'ok' || tipo === 'vazio') return encerrar(true)
        }
      })

      function enviarENQ() { if (!encerrado && port?.isOpen) port.write(ENQ) }
      setTimeout(enviarENQ, 100)
      pollTimer = setInterval(enviarENQ, POLL_INTERVALO)
    })
  })
}

/**
 * Aguarda itens serem colocados na balança e confirma quando o peso estabiliza.
 * Usado para "aprender" o peso de produtos sem FORMATO_PRO.
 *
 * Lógica de estabilidade: quando a leitura não varia mais que ±50g por
 * `estabilidadeMs` milissegundos consecutivos, considera que o cliente
 * terminou de colocar os itens.
 *
 * Sempre resolve:
 *   { ok: true,  peso_gramas, peso_absoluto } ✅ peso estabilizado
 *   { ok: false, sem_peso: true }             ⏱ timeout sem produto
 *   { ok: false, sem_comunicacao: true }      🔌 porta não abriu
 */
function medirPeso(timeoutMs, estabilidadeMs = 2000) {
  return new Promise((resolve) => {
    let port, timer, baselineTimer, pollTimer, estabilidadeTimer
    let buffer      = Buffer.alloc(0)
    let encerrado   = false
    let baseline    = null
    let ultimoPeso  = null  // última leitura estável acima do baseline

    function encerrar(resultado) {
      if (encerrado) return
      encerrado = true
      clearTimeout(timer)
      clearTimeout(baselineTimer)
      clearTimeout(estabilidadeTimer)
      clearInterval(pollTimer)
      try { port?.isOpen && port.close() } catch (_) {}
      resolve(resultado)
    }

    function confirmarPeso() {
      const adicao = ultimoPeso - baseline
      console.log(`[balanca/medir] estabilizado: ${ultimoPeso}g | baseline: ${baseline}g | delta: ${adicao}g`)
      encerrar({ ok: true, peso_gramas: adicao, peso_absoluto: ultimoPeso })
    }

    function reiniciarEstabilidade(pesoAtual) {
      // Novo peso significativamente diferente → reinicia o contador
      ultimoPeso = pesoAtual
      clearTimeout(estabilidadeTimer)
      estabilidadeTimer = setTimeout(confirmarPeso, estabilidadeMs)
      console.log(`[balanca/medir] leitura: ${pesoAtual}g — aguardando ${estabilidadeMs / 1000}s de estabilidade…`)
    }

    try {
      port = new SerialPort(SERIAL_OPTS)
    } catch (_) { return resolve({ ok: false, sem_comunicacao: true }) }

    port.open(err => {
      if (err) return resolve({ ok: false, sem_comunicacao: true })

      timer = setTimeout(() => {
        // Timeout global: se já havia algo na balança, confirma o que tiver
        if (ultimoPeso !== null && ultimoPeso - baseline > 30) {
          confirmarPeso()
        } else {
          encerrar({ ok: false, sem_peso: true })
        }
      }, timeoutMs)

      baselineTimer = setTimeout(() => {
        if (baseline === null) {
          console.warn('[balanca/medir] baseline não capturado em 3s, assumindo 0g')
          baseline = 0
        }
      }, 3000)

      port.on('error', () => encerrar({ ok: false, sem_comunicacao: true }))

      port.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk])
        while (!encerrado) {
          const stxPos = buffer.indexOf(STX)
          const etxPos = buffer.indexOf(ETX, stxPos + 1)
          if (stxPos === -1 || etxPos === -1) break
          const len = etxPos - stxPos - 1
          if (len !== 5) { buffer = buffer.slice(etxPos + 1); continue }
          const payload = buffer.slice(stxPos + 1, etxPos)
          buffer = buffer.slice(etxPos + 1)
          const { tipo, peso } = classificarPayload(payload)

          // ── Fase 1: captura baseline ──────────────────────────────────
          if (baseline === null) {
            if (tipo === 'ok' || tipo === 'vazio') {
              baseline = peso
              clearTimeout(baselineTimer)
              console.log(`[balanca/medir] baseline: ${baseline}g`)
            }
            continue
          }

          // ── Fase 2: detecta adição e aguarda estabilidade ─────────────
          if (tipo === 'instavel') {
            // Balança oscilando — reinicia estabilidade se já havia peso
            if (ultimoPeso !== null) {
              clearTimeout(estabilidadeTimer)
              console.log('[balanca/medir] instável — aguardando…')
            }
            continue
          }

          if (tipo !== 'ok') continue

          const adicao = peso - baseline
          if (adicao <= 30) {
            // Nada relevante ainda
            if (ultimoPeso !== null) {
              // Produto foi retirado da balança
              ultimoPeso = null
              clearTimeout(estabilidadeTimer)
              console.log('[balanca/medir] peso removido — aguardando novo item…')
            }
            continue
          }

          // Há algo na balança
          if (ultimoPeso === null) {
            // Primeiro item detectado
            reiniciarEstabilidade(peso)
          } else if (Math.abs(peso - ultimoPeso) > 50) {
            // Peso mudou significativamente (novo item colocado)
            reiniciarEstabilidade(peso)
          }
          // Se a diferença for ≤ 50g, a leitura está estável — não reinicia o timer
        }
      })

      function enviarENQ() { if (!encerrado && port?.isOpen) port.write(ENQ) }
      setTimeout(enviarENQ, 150)
      pollTimer = setInterval(enviarENQ, POLL_INTERVALO)
    })
  })
}

/**
 * Lê o peso atual da balança aguardando estabilidade.
 * Diferente de medirPeso, não exige aumento em relação ao baseline —
 * apenas espera que a leitura fique constante por `estabilidadeMs`.
 * Usado no check de total no pagamento.
 *
 * Resolve:
 *   { ok: true,  peso_gramas }           ✅ leitura estável
 *   { ok: false, sem_comunicacao: true } 🔌 porta não abriu
 */
function lerPesoEstavel(timeoutMs = 5000, estabilidadeMs = 2000) {
  return new Promise((resolve) => {
    let port, timer, pollTimer, estabilidadeTimer
    let buffer     = Buffer.alloc(0)
    let encerrado  = false
    let ultimoPeso = null

    function encerrar(resultado) {
      if (encerrado) return
      encerrado = true
      clearTimeout(timer)
      clearTimeout(estabilidadeTimer)
      clearInterval(pollTimer)
      try { port?.isOpen && port.close() } catch (_) {}
      resolve(resultado)
    }

    function confirmar() {
      console.log(`[balanca/peso-estavel] estável: ${ultimoPeso}g`)
      encerrar({ ok: true, peso_gramas: ultimoPeso })
    }

    function reiniciarEstabilidade(peso) {
      ultimoPeso = peso
      clearTimeout(estabilidadeTimer)
      estabilidadeTimer = setTimeout(confirmar, estabilidadeMs)
    }

    try { port = new SerialPort(SERIAL_OPTS) }
    catch (_) { return resolve({ ok: false, sem_comunicacao: true }) }

    port.open(err => {
      if (err) return resolve({ ok: false, sem_comunicacao: true })

      // Timeout global: usa a última leitura disponível, ou falha
      timer = setTimeout(() => {
        if (ultimoPeso !== null) encerrar({ ok: true, peso_gramas: ultimoPeso })
        else encerrar({ ok: false, sem_comunicacao: true })
      }, timeoutMs)

      port.on('error', () => encerrar({ ok: false, sem_comunicacao: true }))

      port.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk])
        while (!encerrado) {
          const stxPos = buffer.indexOf(STX)
          const etxPos = buffer.indexOf(ETX, stxPos + 1)
          if (stxPos === -1 || etxPos === -1) break
          const len = etxPos - stxPos - 1
          if (len !== 5) { buffer = buffer.slice(etxPos + 1); continue }
          const payload = buffer.slice(stxPos + 1, etxPos)
          buffer = buffer.slice(etxPos + 1)
          const { tipo, peso } = classificarPayload(payload)

          if (tipo === 'instavel') {
            clearTimeout(estabilidadeTimer)
            continue
          }
          if (tipo !== 'ok' && tipo !== 'vazio') continue

          if (ultimoPeso === null || Math.abs(peso - ultimoPeso) > 50) {
            reiniciarEstabilidade(peso)
          }
        }
      })

      function enviarENQ() { if (!encerrado && port?.isOpen) port.write(ENQ) }
      setTimeout(enviarENQ, 100)
      pollTimer = setInterval(enviarENQ, POLL_INTERVALO)
    })
  })
}

// ── Rotas ────────────────────────────────────────────────────────────────

/** GET /api/balanca/config — retorna configuração da balança (habilitada, porta, etc.) */
router.get('/config', (_req, res) => {
  res.json({ habilitada: HABILITADA, porta: PORTA, baudRate: BAUD })
})

/** GET /api/balanca/teste — verifica se a balança está respondendo (usado na abertura de caixa) */
router.get('/teste', async (_req, res) => {
  if (!HABILITADA) return res.json({ ok: true, habilitada: false })
  const resultado = await testarComunicacao()
  console.log(`[balanca] Teste de comunicação: ${resultado.ok ? '✅ OK' : '❌ Sem resposta'}`)
  res.json({ ...resultado, habilitada: true })
})

/**
 * GET /api/balanca/peso-estavel?timeout=5000&estabilidade=2000
 * Lê o peso atual aguardando estabilidade. Usado no check do pagamento.
 */
router.get('/peso-estavel', async (req, res) => {
  const timeoutMs      = parseInt(req.query.timeout,      10) || 5000
  const estabilidadeMs = parseInt(req.query.estabilidade, 10) || 2000
  if (!HABILITADA) return res.json({ ok: true, desabilitada: true, peso_gramas: 0 })
  const resultado = await lerPesoEstavel(timeoutMs, estabilidadeMs)
  res.json(resultado)
})

/** GET /api/balanca/peso */
router.get('/peso', async (_req, res) => {
  try {
    const r = await lerPeso()
    console.log(`[balanca] Peso lido: ${r.peso_gramas}g (${r.tentativas} frames)`)
    res.json({ ok: true, peso_gramas: r.peso_gramas })
  } catch (e) {
    console.error('[balanca] GET /peso —', e.message)
    res.status(503).json({ ok: false, erro: e.message })
  }
})

/**
 * GET /api/balanca/aguardar?delta=420&tolerancia=15&timeout=12000
 *
 * delta      = peso do produto (FORMATO_PRO), em gramas
 * tolerancia = % de tolerância (default 15)
 * timeout    = ms (default 12000)
 *
 * O backend lê o baseline atual da balança (tudo que já está lá) e verifica
 * se o total subiu pelo delta. Cada produto é conferido individualmente.
 *
 * Sempre HTTP 200:
 *   { ok: true,  peso_gramas }
 *   { ok: false, divergencia: true, peso_gramas? }
 *   { ok: false, sem_peso: true }
 */
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

/**
 * GET /api/balanca/medir?timeout=15000
 *
 * Mede o peso do próximo item colocado na balança (delta sobre o baseline atual).
 * Usado para produtos sem FORMATO_PRO — o sistema aprende e salva o peso.
 *
 * Sempre HTTP 200:
 *   { ok: true,  peso_gramas }
 *   { ok: false, sem_peso: true }
 *   { ok: false, sem_comunicacao: true }
 */
router.get('/medir', async (req, res) => {
  const timeoutMs     = parseInt(req.query.timeout,      10) || 15000
  const estabilidadeMs = parseInt(req.query.estabilidade, 10) || 2000
  if (!HABILITADA) return res.json({ ok: true, desabilitada: true })
  const resultado = await medirPeso(timeoutMs, estabilidadeMs)
  console.log(`[balanca] /medir (estab=${estabilidadeMs}ms) →`, resultado)
  res.json(resultado)
})

module.exports = router
