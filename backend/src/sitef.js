/**
 * sitef.js — Integração com ClientSiTef via troca de arquivos
 * Protocolo: IntPos.001 / IntPos.STS em C:\cliente\Req e C:\cliente\Resp
 * Referência: Manual da Interface Cliente SiTef v4.07k
 */

const fs   = require('fs')
const path = require('path')
const { SITEF_DIR_REQ, SITEF_DIR_RESP } = require('./config')

const REQ_DIR  = SITEF_DIR_REQ
const RESP_DIR = SITEF_DIR_RESP

const REQ_FILE = path.join(REQ_DIR,  'IntPos.001')
const REQ_TMP  = path.join(REQ_DIR,  'IntPos.tmp')
const RESP_001 = path.join(RESP_DIR, 'IntPos.001')
const RESP_STS = path.join(RESP_DIR, 'IntPos.STS')

// Timeout padrão aguardando o cliente inserir o cartão (2 min)
const TIMEOUT_CARTAO_MS = 120_000
// Timeout para etapas rápidas (STS, CNF)
const TIMEOUT_STS_MS    =  30_000

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converte valor numérico para formato SiTef: 260.70 → "260,70" */
function formatarValor(valor) {
  return Number(valor).toFixed(2).replace('.', ',')
}

/** DDMMAAAA → "DD/MM/AAAA" */
function fmtData(s) {
  if (!s || s.length < 8) return ''
  return `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4, 8)}`
}

/** HHMMSS → "HH:MM" */
function fmtHora(s) {
  if (!s || s.length < 4) return ''
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`
}

/** Parseia arquivo SiTef em mapa { "000-000": "CRT", ... } */
function parsearArquivo(conteudo) {
  const campos = {}
  for (const linha of conteudo.split('\n')) {
    const m = linha.trim().match(/^(\d{3}-\d{3,})\s*=\s*(.*)$/)
    if (m) campos[m[1]] = m[2].trim()
  }
  return campos
}

/** Monta conteúdo do arquivo SiTef a partir de um objeto de campos */
function montarConteudo(campos) {
  return Object.entries(campos)
    .map(([k, v]) => `${k} = ${v}\r\n`)
    .join('')
}

/** Escreve IntPos.tmp e renomeia para IntPos.001 (regra obrigatória do manual) */
function escreverRequisicao(campos) {
  const conteudo = montarConteudo(campos)
  fs.writeFileSync(REQ_TMP, conteudo, 'latin1')
  if (fs.existsSync(REQ_FILE)) fs.unlinkSync(REQ_FILE)
  fs.renameSync(REQ_TMP, REQ_FILE)
  console.log('[SiTef] REQ escrito:', JSON.stringify(campos))
}

/** Remove arquivo sem lançar erro se não existir */
function deletar(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch (e) {
    console.warn('[SiTef] deletar falhou:', filePath, e.message)
  }
}

/** Aguarda um arquivo aparecer no disco (polling a cada 300ms) */
function aguardarArquivo(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now()
    const tick = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(tick)
        resolve()
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(tick)
        reject(new Error(`SiTef timeout aguardando ${path.basename(filePath)} (${timeoutMs / 1000}s)`))
      }
    }, 300)
  })
}

/** Lê e parseia um arquivo de resposta do SiTef */
function lerArquivo(filePath) {
  const conteudo = fs.readFileSync(filePath, 'latin1')
  return parsearArquivo(conteudo)
}

/** Coleta as linhas do cupom a partir dos campos 028/029 */
function extrairCupom(campos) {
  const qtd = parseInt(campos['028-000'] || '0', 10)
  if (qtd === 0) return []
  const linhas = []
  for (let i = 1; i <= qtd; i++) {
    linhas.push(campos[`029-${String(i).padStart(3, '0')}`] || '')
  }
  return linhas
}

// ── Fluxo de transação ────────────────────────────────────────────────────────

/**
 * Realiza uma transação de cartão (crédito ou débito) via SiTef.
 *
 * @param {Object} opts
 * @param {string|number} opts.idControle  - Nº controle único gerado pelo PDV
 * @param {string|number} opts.docFiscal   - Nº do cupom/nota fiscal
 * @param {number}        opts.valor       - Valor total (ex: 10.50)
 * @param {number}        [opts.parcelas]  - Qtd parcelas (default 1 = à vista)
 *
 * @returns {Promise<{aprovado, nomeProduto, nsuHost, codAutorizacao, linhasCupom, campos}>}
 */
async function realizarTransacaoCRT({ idControle, docFiscal, valor, parcelas = 1 }) {
  // Garante que não há arquivos anteriores sujos
  deletar(RESP_001)
  deletar(RESP_STS)

  // ── P1: Solicitação ────────────────────────────────────────────────────────
  const reqCampos = {
    '000-000': 'CRT',
    '001-000': String(idControle),
    '002-000': String(docFiscal),
    '003-000': formatarValor(valor),
    '004-000': '0',
    '999-999': '0',
  }
  if (parcelas > 1) {
    reqCampos['017-000'] = '0'                          // parcelado pelo estabelecimento
    reqCampos['018-000'] = String(parcelas).padStart(2, '0')
  }
  escreverRequisicao(reqCampos)

  // ── P2: Confirmação de recebimento (IntPos.STS) ────────────────────────────
  await aguardarArquivo(RESP_STS, TIMEOUT_STS_MS)
  deletar(RESP_STS)
  console.log('[SiTef] P2 STS recebido')

  // ── P3: SiTef processa (aguarda cliente inserir cartão) ───────────────────
  // ── P4: Resposta com resultado ────────────────────────────────────────────
  await aguardarArquivo(RESP_001, TIMEOUT_CARTAO_MS)
  const resp = lerArquivo(RESP_001)
  deletar(RESP_001)
  console.log('[SiTef] P4 resposta:', JSON.stringify(resp))

  const aprovado       = (resp['009-000'] || '1') === '0'
  const nomeProduto    = resp['010-000'] || ''
  const nsuHost        = resp['012-000'] || ''
  const codAutorizacao = resp['013-000'] || ''
  const finalizacao    = resp['027-000'] || ''
  const linhasCupom    = extrairCupom(resp)
  const dataTx         = fmtData(resp['022-000'] || '')
  const horaTx         = fmtHora(resp['023-000'] || '')
  const parcelasTx     = parseInt(resp['018-000'] || '1', 10) || 1
  const valorTx        = resp['003-000'] || formatarValor(valor)

  if (!aprovado) {
    // ── P6-NCN: Não confirmação ───────────────────────────────────────────
    escreverRequisicao({
      '000-000': 'NCN',
      '001-000': String(idControle),
      '002-000': String(docFiscal),
      '010-000': nomeProduto,
      '012-000': nsuHost,
      '027-000': finalizacao,
      '999-999': '0',
    })
    await aguardarArquivo(RESP_STS, TIMEOUT_STS_MS)
    deletar(RESP_STS)
    console.log('[SiTef] NCN confirmado — transação negada')
    return { aprovado: false, nomeProduto, nsuHost, dataTx, horaTx, parcelasTx, valorTx, linhasCupom: [], campos: resp }
  }

  // ── P6: Confirmação com status de impressão ────────────────────────────────
  escreverRequisicao({
    '000-000': 'CNF',
    '001-000': String(idControle),
    '002-000': String(docFiscal),
    '010-000': nomeProduto,
    '012-000': nsuHost,
    '027-000': finalizacao,
    '999-999': '0',
  })

  // ── P7: Confirmação final ──────────────────────────────────────────────────
  await aguardarArquivo(RESP_STS, TIMEOUT_STS_MS)
  deletar(RESP_STS)
  console.log('[SiTef] P7 confirmado — transação aprovada')

  return { aprovado: true, nomeProduto, nsuHost, codAutorizacao, finalizacao, dataTx, horaTx, parcelasTx, valorTx, linhasCupom, campos: resp }
}

module.exports = { realizarTransacaoCRT, formatarValor }
