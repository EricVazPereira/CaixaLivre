const express = require('express')
const router  = express.Router()
const { NM_ESTACAO, verificarCaixaAberto, abrirCaixaERP, gravarItensERP, fecharComandaERP, fecharCaixaERP } = require('../erp')

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

  // estacao_nao_cadastrada: quando a API de registro de estação for criada,
  // este campo será true caso nm_estacao não exista no ERP.
  return res.json({ aberto, nm_estacao, estacao_nao_cadastrada: false })
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

    return res.json({ ok: true, nm_estacao: NM_ESTACAO, erp: erpResult })
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

    // ERP pode retornar HTTP 200 com objeto de erro interno
    const primeiro = Array.isArray(erpResult) ? erpResult[0] : erpResult
    if (primeiro?.erro === true) {
      const msg = primeiro.erro_message || 'ERP recusou o registro do item'
      console.warn('[GravaItens] ERP retornou erro lógico:', msg)
      return res.status(502).json({ erro: msg })
    }

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

  // O DataSnap do Fênix pode lançar erros transientes relacionados ao ciclo de vida do
  // contexto Delphi. Nesses casos aguardamos 2s e tentamos novamente:
  //   "A component named OPERADORA already exists" — componente ainda não liberado pelo GC
  //   "CachedUpdates not enabled"                  — dataset em estado inconsistente, se resolve sozinho
  const ALREADY_EXISTS_RE  = /component named .+ already exists/i
  const CACHED_UPDATES_RE  = /CachedUpdates not enabled/i

  async function tentarFechar() {
    const erpResult = await fecharCaixaERP(cod_executor)
    const sucesso   = erpResult?.sucess === true
    if (!sucesso) throw new Error(erpResult?.message_sucess || 'ERP recusou o fechamento')
    return erpResult
  }

  try {
    console.log('[fechar-erp] Chamando ERP FechamentoCX — estação:', NM_ESTACAO)
    let erpResult
    try {
      erpResult = await tentarFechar()
    } catch (e) {
      if (ALREADY_EXISTS_RE.test(e.message)) {
        console.warn('[fechar-erp] DataSnap retornou "already exists" — aguardando 2s e tentando novamente...')
        await new Promise(r => setTimeout(r, 2000))
        erpResult = await tentarFechar()   // lança se falhar de novo
      } else if (CACHED_UPDATES_RE.test(e.message)) {
        console.warn('[fechar-erp] DataSnap retornou "CachedUpdates not enabled" — aguardando 2s e tentando novamente...')
        await new Promise(r => setTimeout(r, 2000))
        erpResult = await tentarFechar()   // lança se falhar de novo
      } else {
        throw e
      }
    }

    console.log('[fechar-erp] Resposta do ERP:', JSON.stringify(erpResult))
    return res.json({ ok: true, mensagem: erpResult.message_sucess, erp: erpResult })
  } catch (err) {
    console.error('[fechar-erp] Erro:', err.message)
    res.status(502).json({ erro: err.message })
  }
})

module.exports = router
