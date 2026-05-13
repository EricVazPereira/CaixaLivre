/**
 * config.js — Lê Network.ini uma vez na inicialização e exporta todas as configs.
 * Importar aqui em vez de duplicar o parser em cada módulo.
 */

const fs   = require('fs')
const path = require('path')

const INI_PATH = path.resolve(__dirname, '../../Network.ini')

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

// ── Seção [PARAMETROS DA CONEXAO] — banco de dados Firebird ──────────────────
const cfgBD      = lerSecaoIni(INI_PATH, 'PARAMETROS DA CONEXAO')
const pathBD     = (cfgBD['PATH DO BD SERVIDOR'] || 'localhost:C:/fenix/bd/ORESTRA.FDB').trim()

// Formato: "host:caminho" ou apenas "caminho" (localhost implícito)
let DB_HOST     = 'localhost'
let DB_DATABASE = pathBD
const colonIdx  = pathBD.indexOf(':')
// Se tiver dois-pontos e não for letra de drive Windows (ex: C:), é host:path
if (colonIdx > 1) {
  DB_HOST     = pathBD.slice(0, colonIdx)
  DB_DATABASE = pathBD.slice(colonIdx + 1)
}

const DB_USER     = (cfgBD['Usuario'] || 'SYSDBA').trim()
const DB_PASSWORD = (cfgBD['Senha']   || 'masterkey').trim()

console.log(`[config] Firebird → ${DB_HOST} | ${DB_DATABASE} | usuário: ${DB_USER}`)

// ── Seção [NFCE] ──────────────────────────────────────────────────────────────
const cfgNFCE = lerSecaoIni(INI_PATH, 'NFCE')
// Só habilita quando explicitamente definido como sim/yes/1/true
const _nfceStr = (cfgNFCE['Habilitar Nfce'] || '').trim().toLowerCase()
const NFCE_HABILITADO = _nfceStr === 'sim' || _nfceStr === 'yes' || _nfceStr === '1' || _nfceStr === 'true'
console.log(`[config] NFC-e → ${NFCE_HABILITADO ? 'HABILITADO' : 'desabilitado'}`)

// ── Servidor central (porta fixa) ─────────────────────────────────────────────
const SERVIDOR_PORTA = 3001

// ── Exportações ───────────────────────────────────────────────────────────────
module.exports = { ERP_HOST, ERP_PORT, ERP_HTTPS, API_ENDERECO, ERP_AUTH, AGENTE_PORTA, SERVIDOR_PORTA, NM_ESTACAO, DB_HOST, DB_DATABASE, DB_USER, DB_PASSWORD, NFCE_HABILITADO }
