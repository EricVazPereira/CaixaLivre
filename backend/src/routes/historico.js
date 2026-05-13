const express = require('express')
const router  = express.Router()
const { query } = require('../db')
const { NM_ESTACAO, verificarCaixaAberto, abrirCaixaERP, gravarItensERP, fecharComandaERP, fecharCaixaERP } = require('../erp')

// ── Helpers ──────────────────────────────────────────────────────────────────

async function buscarIdHistorico(nmEstacao) {
  const rows = await query(
    `SELECT FIRST 1 ID_HISTORICO FROM HISTORICO
      WHERE NM_ESTACAO = ?
      ORDER BY ID_HISTORICO DESC`,
    [nmEstacao]
  )
  return rows.length ? rows[0]['ID_HISTORICO'] : null
}

// ── GET /status — verifica se o caixa está aberto via ERP ───────────────────

router.get('/status', async (req, res) => {
  let aberto     = false
  let nm_estacao = NM_ESTACAO

  try {
    const erpStatus = await verificarCaixaAberto()
    aberto     = erpStatus.aberto
    nm_estacao = erpStatus.nm_estacao
  } catch (err) {
    console.warn('[historico] GET /status — ERP indisponível:', err.message)
  }

  // Se ERP diz aberto, busca o ID_HISTORICO mais recente desta estação
  let id_historico = null
  if (aberto) {
    try {
      id_historico = await buscarIdHistorico(nm_estacao)
      if (!id_historico) {
        console.warn('[historico] GET /status — ERP aberto mas sem HISTORICO no banco')
        aberto = false
      }
    } catch (err) {
      console.warn('[historico] GET /status — erro ao consultar HISTORICO:', err.message)
      aberto = false
    }
  }

  return res.json({ aberto, nm_estacao, id_historico })
})

// ── POST /abrir-erp — abre o caixa via ERP ───────────────────────────────────

router.post('/abrir-erp', async (req, res) => {
  const { cod_operador = '0', cod_executor = '0' } = req.body

  try {
    console.log('[abrir-erp] Chamando ERP AberturaCX — estação:', NM_ESTACAO)
    const erpResult = await abrirCaixaERP(cod_operador, cod_executor)
    console.log('[abrir-erp] Resposta do ERP:', JSON.stringify(erpResult))

    await new Promise(r => setTimeout(r, 800))
    const confirmacao = await verificarCaixaAberto()
    console.log('[abrir-erp] VerficaCxAberto após abertura:', confirmacao.aberto ? 'ABERTO ✓' : 'FECHADO ✗')

    // Lê o HISTORICO criado pelo ERP
    const id_historico = await buscarIdHistorico(NM_ESTACAO)
    if (!id_historico) {
      throw new Error('ERP processou a abertura mas nenhum HISTORICO foi encontrado no banco para a estação ' + NM_ESTACAO)
    }

    return res.json({ ok: true, nm_estacao: NM_ESTACAO, id_historico, erp: erpResult })
  } catch (err) {
    console.error('[abrir-erp] Erro:', err.message)
    res.status(502).json({ erro: err.message })
  }
})

// ── POST /grava-itens — grava itens no ERP ───────────────────────────────────

router.post('/grava-itens', async (req, res) => {
  const { id = '', nrMesa = '', consumo } = req.body

  if (!Array.isArray(consumo) || consumo.length === 0) {
    return res.status(400).json({ erro: 'consumo deve ser um array com ao menos 1 item' })
  }

  for (const item of consumo) {
    if (!item.produto_codigo || !(item.quantidade > 0) || !(item.vl_unitario >= 0)) {
      return res.status(400).json({ erro: `Item inválido: ${JSON.stringify(item)}` })
    }
  }

  try {
    const erpResult = await gravarItensERP({ id, nrMesa, consumo })
    console.log('[GravaItens] Retorno do ERP:', JSON.stringify(erpResult))
    return res.json({ ok: true, erp: erpResult })
  } catch (err) {
    console.error('[GravaItens] Erro:', err.message)
    res.status(502).json({ erro: err.message })
  }
})

// ── POST /fechar-comanda — fecha a comanda no ERP ────────────────────────────

router.post('/fechar-comanda', async (req, res) => {
  const { subtotal, total, barcode, discount, cpf, add_service, forma_pagamento } = req.body

  if (!barcode)         return res.status(400).json({ erro: 'barcode é obrigatório' })
  if (!total)           return res.status(400).json({ erro: 'total é obrigatório' })
  if (!forma_pagamento) return res.status(400).json({ erro: 'forma_pagamento é obrigatório' })

  // TODO: substituir VISA pela operadora real quando implementar seleção de bandeira
  const operadoraMap = { pix: 'PIX', credito: 'VISA', debito: 'VISA' }
  const operadoraNome = operadoraMap[forma_pagamento] || forma_pagamento.toUpperCase()
  const operadora = `${operadoraNome}|${total}|`

  try {
    const erpResult = await fecharComandaERP({ subtotal, total, barcode, discount, cpf, add_service, operadora })
    console.log('[FechamentoComandaSmartPDV] Resposta do ERP:', JSON.stringify(erpResult))

    // DataSnap pode retornar HTTP 200 com um objeto indicando erro no campo message_sucess/ErrorMessage
    const erpMsg = erpResult?.message_sucess ?? erpResult?.ErrorMessage ?? null
    const erpOk  = erpResult?.sucess !== false && !erpResult?.ErrorCode

    if (!erpOk && erpMsg) {
      console.warn('[FechamentoComandaSmartPDV] ERP retornou erro lógico:', erpMsg)
      return res.status(502).json({ erro: erpMsg })
    }

    return res.json({ ok: true, erp: erpResult })
  } catch (err) {
    // Garante que o campo erro nunca seja vazio, mesmo se err não for um Error padrão
    const msg = (err instanceof Error ? err.message : String(err)) || 'Erro desconhecido no fechamento da comanda'
    console.error('[FechamentoComandaSmartPDV] Erro:', msg)
    if (err?.stack) console.error(err.stack)
    res.status(502).json({ erro: msg })
  }
})

// ── POST /fechar-erp — fecha o caixa via ERP ─────────────────────────────────

router.post('/fechar-erp', async (req, res) => {
  const { cod_executor = '0' } = req.body

  try {
    console.log('[fechar-erp] Chamando ERP FechamentoCX — estação:', NM_ESTACAO)
    const erpResult = await fecharCaixaERP(cod_executor)
    console.log('[fechar-erp] Resposta do ERP:', JSON.stringify(erpResult))

    // ERP retorna sucess:true mesmo se o caixa não estava aberto — verificar mensagem
    const sucesso = erpResult?.sucess === true
    if (!sucesso) {
      return res.status(502).json({ erro: erpResult?.message_sucess || 'ERP recusou o fechamento' })
    }

    return res.json({ ok: true, mensagem: erpResult.message_sucess, erp: erpResult })
  } catch (err) {
    console.error('[fechar-erp] Erro:', err.message)
    res.status(502).json({ erro: err.message })
  }
})

module.exports = router
