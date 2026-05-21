const { Router } = require('express');
const { cancelarContaERP, cancelarItemERP } = require('../erp');

const router = Router();

// ── POST /api/contas/:nr_gerador/cancelar — Cancela uma venda no ERP ─────────

router.post('/:nr_gerador/cancelar', async (req, res) => {
  const { nr_gerador } = req.params;
  const { valor_conta = '0', valor_acrescimo = '0' } = req.body || {};

  if (!nr_gerador) {
    return res.status(400).json({ ok: false, erro: 'nr_gerador é obrigatório' });
  }

  try {
    const erp = await cancelarContaERP({ nr_gerador, valor_conta, valor_acrescimo });
    res.json({ ok: true, erp });
  } catch (e) {
    console.error('[contas] POST /:nr_gerador/cancelar', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ── POST /api/contas/:nr_gerador/cancelar-item — Cancela um item da conta no ERP ──

router.post('/:nr_gerador/cancelar-item', async (req, res) => {
  const { nr_gerador } = req.params;
  const { ordem_item } = req.body || {};

  if (!nr_gerador || !ordem_item) {
    return res.status(400).json({ ok: false, erro: 'nr_gerador e ordem_item são obrigatórios' });
  }

  try {
    console.log(`[contas] CancelarItem nr_gerador=${nr_gerador} ordem_item=${ordem_item}`);
    const erp = await cancelarItemERP({ nr_gerador, ordem_item });
    res.json({ ok: true, itens_restantes: erp });
  } catch (e) {
    console.error('[contas] POST /:nr_gerador/cancelar-item', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

module.exports = router;
