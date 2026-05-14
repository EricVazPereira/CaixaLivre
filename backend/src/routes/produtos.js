const { Router } = require('express');
const { consultaFormatoProduto, gravaFormatoProduto } = require('../erp');

const router = Router();

function pad14(codigo) {
  return String(codigo).replace(/\D/g, '').padStart(14, '0');
}

/** Converte preço no formato brasileiro "1,00" para número */
function parseBRL(s) {
  const n = parseFloat(String(s || '0').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/**
 * GET /api/produtos/:codigo
 * Consulta produto inteiramente via API do ERP — sem acesso direto ao banco.
 */
router.get('/:codigo', async (req, res) => {
  try {
    const codigo = pad14(req.params.codigo);
    const p = await consultaFormatoProduto(codigo);

    console.log(`[produtos] ConsultaFormatoProduto raw (${codigo}):`, JSON.stringify(p))

    if (!p || p['fl_ativo'] === '0' || !p['cod_pro']) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }

    const pesoRaw = parseInt(p['formato_pro'], 10);
    const peso_gramas = !isNaN(pesoRaw) && pesoRaw > 0 ? pesoRaw : null;

    res.json({
      codigo:         (p['cod_pro']  || '').trim(),
      descricao:      (p['ds_pro']   || '').trim(),
      valor_unitario:  parseBRL(p['vl_venda']),
      unidade:        (p['un_pro']   || 'UN').trim(),
      peso_gramas,
    });
  } catch (e) {
    console.error('[produtos] GET /:codigo', e.message);
    res.status(404).json({ erro: 'Produto não encontrado' });
  }
});

/**
 * PATCH /api/produtos/:codigo/formato-pro
 * Salva o peso aprendido pela balança no FORMATO_PRO via ERP.
 */
router.patch('/:codigo/formato-pro', async (req, res) => {
  try {
    const codigo = pad14(req.params.codigo);
    const peso   = parseInt(req.body?.peso_gramas, 10);
    if (!peso || peso <= 0) {
      return res.status(400).json({ erro: 'peso_gramas inválido' });
    }
    await gravaFormatoProduto(codigo, peso);
    console.log(`[produtos] FORMATO_PRO gravado via ERP: ${codigo} → ${peso}g`);
    res.json({ ok: true, codigo, peso_gramas: peso });
  } catch (e) {
    console.error('[produtos] PATCH /:codigo/formato-pro', e.message);
    res.status(500).json({ erro: 'Erro ao atualizar FORMATO_PRO' });
  }
});

module.exports = router;
