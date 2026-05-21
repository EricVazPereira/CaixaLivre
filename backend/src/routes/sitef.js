const { Router } = require('express')
const { realizarTransacaoCRT } = require('../sitef')

const router = Router()

/**
 * POST /api/sitef/crt
 * Executa uma transação de cartão (crédito ou débito) via ClientSiTef.
 * A requisição aguarda até que o cliente insira o cartão e o SiTef responda
 * (timeout interno de 2 min). O frontend deve exibir tela de espera.
 *
 * Body: { idControle, docFiscal, valor, parcelas? }
 * Retorna: { ok, aprovado, nomeProduto, nsuHost, codAutorizacao, finalizacao, linhasCupom, campos }
 */
router.post('/crt', async (req, res) => {
  const { idControle, docFiscal, valor, parcelas = 1 } = req.body || {}

  if (!idControle || !docFiscal || !valor) {
    return res.status(400).json({
      ok: false,
      erro: 'Parâmetros obrigatórios: idControle, docFiscal, valor',
    })
  }

  try {
    const resultado = await realizarTransacaoCRT({
      idControle,
      docFiscal,
      valor: Number(valor),
      parcelas: Number(parcelas) || 1,
    })
    res.json({ ok: true, ...resultado })
  } catch (e) {
    console.error('[SiTef] Erro na transação CRT:', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

module.exports = router
