const { Router } = require('express')
const { SITEF_HABILITADO, CANCELAMENTO_LIBERADO } = require('../config')

const router = Router()

/** GET /api/config — configurações que o frontend precisa em runtime */
router.get('/', (_req, res) => {
  res.json({
    sitefHabilitado:       SITEF_HABILITADO,
    cancelamentoLiberado:  CANCELAMENTO_LIBERADO,
  })
})

module.exports = router
