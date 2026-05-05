const { Router } = require('express')
const { query }  = require('../db')

const router = Router()

/**
 * POST /api/auth/validar-codigo-geral
 * Valida o código digitado contra o usuário GERAL (ID_USU = 0) na tabela USUARIO.
 */
router.post('/validar-codigo-geral', async (req, res) => {
  const { codigo } = req.body || {}
  if (!codigo) return res.status(400).json({ ok: false, erro: 'Código não informado.' })

  try {
    const rows = await query(
      `SELECT SENHA_USU FROM USUARIO WHERE ID_USU = 0 AND FL_ATIVO_USU = 1`
    )
    if (!rows.length) return res.status(500).json({ ok: false, erro: 'Usuário GERAL não encontrado.' })

    const senhaCorreta = (rows[0]['SENHA_USU'] || '').trim()
    if (codigo.trim() === senhaCorreta) {
      res.json({ ok: true })
    } else {
      res.status(401).json({ ok: false, erro: 'Código incorreto.' })
    }
  } catch (e) {
    console.error('[auth] validar-codigo-geral', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

module.exports = router
