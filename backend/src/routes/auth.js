const { Router } = require('express')
const { verificarPermissaoERP } = require('../erp')

const router = Router()

/**
 * POST /api/auth/verificar-permissao
 * Verifica se o funcionário tem permissão para executar uma ação no ERP.
 * Body: { funcao, codigo?, senha }
 * Retorna: { ok: bool, mensagem: string }
 */
router.post('/verificar-permissao', async (req, res) => {
  const { funcao, codigo = '0', senha } = req.body || {}
  if (!funcao || !senha) {
    return res.status(400).json({ ok: false, erro: 'funcao e senha são obrigatórios' })
  }
  try {
    const erp = await verificarPermissaoERP({ funcao, codigo, senha })
    const ok  = String(erp?.Resultado).toLowerCase() === 'true'
    console.log(`[auth] VerificaPermissao funcao=${funcao} → ${ok ? '✅ permitido' : '❌ negado'} (${erp?.Mensagem || ''})`)
    res.json({ ok, mensagem: erp?.Mensagem || '' })
  } catch (e) {
    console.error('[auth] verificar-permissao', e.message)
    res.status(500).json({ ok: false, erro: 'Erro ao verificar permissão no ERP' })
  }
})

module.exports = router
