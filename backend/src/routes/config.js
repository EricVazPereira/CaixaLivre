const { Router } = require('express')
const { SITEF_HABILITADO } = require('../config')

const router = Router()

/** GET /api/config — configurações que o frontend precisa em runtime */
router.get('/', (_req, res) => {
  res.json({ sitefHabilitado: SITEF_HABILITADO })
})

module.exports = router
