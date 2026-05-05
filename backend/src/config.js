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

// ── Seção [Servidor] ──────────────────────────────────────────────────────────
const cfgServidor   = lerSecaoIni(INI_PATH, 'Servidor')
const SERVIDOR_PORTA = parseInt(cfgServidor['Porta'] || '3001', 10) || 3001

console.log(`[config] Servidor porta → ${SERVIDOR_PORTA}`)

// ── Exportações ───────────────────────────────────────────────────────────────
module.exports = { ERP_HOST, ERP_PORT, ERP_HTTPS, API_ENDERECO, ERP_AUTH, SERVIDOR_PORTA }
