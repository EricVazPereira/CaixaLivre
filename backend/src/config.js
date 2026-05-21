/**
 * config.js — Lê Network.ini uma vez na inicialização e exporta todas as configs.
 * Importar aqui em vez de duplicar o parser em cada módulo.
 */

const fs   = require('fs')
const path = require('path')

// Em modo Electron, main.cjs define CAIXALIVRE_INI apontando para resources/Network.ini
// Em modo standalone (node src/server.js), usa o caminho relativo à raiz do projeto
const INI_PATH = process.env.CAIXALIVRE_INI || path.resolve(__dirname, '../../Network.ini')

function lerSecaoIni(arquivo, secao) {
  try {
    const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/)
    let dentro = false
    const r = {}
    for (const linha of linhas) {
      const t = linha.trim()
      if (!t || t.startsWith(';') || t.startsWith('#')) continue
      if (t.startsWith('[')) {
        dentro = t.toLowerCase() === `[${secao.toLowerCase()}]`
        continue
      }
      if (dentro) {
        const [k, ...v] = t.split('=')
        if (k && v.length) r[k.trim()] = v.join('=').trim()
      }
    }
    return r
  } catch (e) {
    console.warn(`[config] Erro ao ler Network.ini (seção ${secao}):`, e.message)
    return {}
  }
}

// ── Seção [API] ───────────────────────────────────────────────────────────────
const cfgAPI = lerSecaoIni(INI_PATH, 'API')

// Aceita tanto "Endereço" (UTF-8) quanto "Endereco" (sem cedilha)
const API_ENDERECO = (cfgAPI['Endereço'] || cfgAPI['Endereco'] || 'http://localhost:81').trim()

let ERP_HOST  = 'localhost'
let ERP_PORT  = 81
let ERP_HTTPS = false

try {
  const u  = new URL(API_ENDERECO)
  ERP_HOST  = u.hostname
  ERP_PORT  = parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80)
  ERP_HTTPS = u.protocol === 'https:'
} catch {
  console.warn('[config] Endereço de API inválido no Network.ini — usando http://localhost:81')
}

console.log(`[config] API ERP → ${API_ENDERECO} (host: ${ERP_HOST}, porta: ${ERP_PORT})`)

// ── Seção [API] — autenticação ────────────────────────────────────────────────
const ERP_TOKEN = (cfgAPI['Token'] || 'TOKEN_AUTENTICACAO_API').trim()
const ERP_SENHA = (cfgAPI['Senha'] || '123').trim()
const ERP_AUTH  = 'Basic ' + Buffer.from(`${ERP_TOKEN}:${ERP_SENHA}`).toString('base64')

// ── Seção [Agente] — processo local do totem (balança + SiTef) ───────────────
const cfgAgente    = lerSecaoIni(INI_PATH, 'Agente')
const AGENTE_PORTA = parseInt(cfgAgente['Porta'] || '3002', 10) || 3002

console.log(`[config] Agente porta → ${AGENTE_PORTA}`)

// ── Seção [Estacao] — nome da estação enviado ao ERP ─────────────────────────
const cfgEstacao = lerSecaoIni(INI_PATH, 'Estacao')
const NM_ESTACAO = (cfgEstacao['Nome'] || require('os').hostname()).toUpperCase()

console.log(`[config] Estação → ${NM_ESTACAO}`)

// ── Seção [Impressora] — nome da impressora térmica ───────────────────────────
const cfgImpressora   = lerSecaoIni(INI_PATH, 'Impressora')
const IMPRESSORA_NOME = (cfgImpressora['Nome'] || '').trim()

console.log(`[config] Impressora → ${IMPRESSORA_NOME || '(padrão do Windows)'}`)

// ── Seção [NFCE] ──────────────────────────────────────────────────────────────
const cfgNFCE = lerSecaoIni(INI_PATH, 'NFCE')
// Só habilita quando explicitamente definido como sim/yes/1/true
const _nfceStr = (cfgNFCE['Habilitar Nfce'] || '').trim().toLowerCase()
const NFCE_HABILITADO = _nfceStr === 'sim' || _nfceStr === 'yes' || _nfceStr === '1' || _nfceStr === 'true'
console.log(`[config] NFC-e → ${NFCE_HABILITADO ? 'HABILITADO' : 'desabilitado'}`)

// ── Seção [SiTef] ─────────────────────────────────────────────────────────────
const cfgSiTef    = lerSecaoIni(INI_PATH, 'SiTef')
const _sitefStr   = (cfgSiTef['Sitef'] || 'nao').trim().toLowerCase()
const SITEF_HABILITADO = _sitefStr === 'sim' || _sitefStr === 'yes' || _sitefStr === '1' || _sitefStr === 'true'
const SITEF_DIR_REQ  = (cfgSiTef['DirReq']  || 'C:\\cliente\\Req').trim()
const SITEF_DIR_RESP = (cfgSiTef['DirResp'] || 'C:\\cliente\\Resp').trim()
console.log(`[config] SiTef → ${SITEF_HABILITADO ? 'HABILITADO' : 'desabilitado'} | Req: ${SITEF_DIR_REQ} | Resp: ${SITEF_DIR_RESP}`)

// ── Servidor central (porta fixa) ─────────────────────────────────────────────
const SERVIDOR_PORTA = 3001

// ── Exportações ───────────────────────────────────────────────────────────────
module.exports = { ERP_HOST, ERP_PORT, ERP_HTTPS, API_ENDERECO, ERP_AUTH, AGENTE_PORTA, SERVIDOR_PORTA, NM_ESTACAO, NFCE_HABILITADO, SITEF_HABILITADO, SITEF_DIR_REQ, SITEF_DIR_RESP, IMPRESSORA_NOME }
