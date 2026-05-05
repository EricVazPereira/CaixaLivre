const { Router } = require('express');
const { query } = require('../db');
const { consultaFormatoProduto, gravaFormatoProduto } = require('../erp');

const router = Router();

function pad14(codigo) {
  return String(codigo).replace(/\D/g, '').padStart(14, '0');
}

// GET /api/produtos/:codigo
router.get('/:codigo', async (req, res) => {
  try {
    const codigo = pad14(req.params.codigo);

    const rows = await query(
      `SELECT CD_PRO, DS_PRO, VL_VENDA_PRO, QT_EST_ATUAL_PRO, UN_PRO,
              NCM_PRO, SIT_TRIB_PRO, ALIQUOTA_PRO, CD_CST_PRO, CFOP_SAI_SAT_PRO,
              CD_CST_SAI_PRO, CST_PIS_SAI_PRO, CST_COFINS_SAI_PRO
       FROM PRODUTO
       WHERE CD_PRO = ?
         AND FL_ATIVO_PRO = 1
         AND (FL_NAOVENDER_PRO IS NULL OR FL_NAOVENDER_PRO = 0)`,
      [codigo]
    );

    if (!rows.length) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }

    const p = rows[0];

    // Busca FORMATO_PRO via ERP (fonte de verdade); falha silenciosa → peso_gramas null
    let peso_gramas = null;
    try {
      const fmt = await consultaFormatoProduto(codigo);
      const raw = fmt?.formato_pro ?? fmt?.FORMATO_PRO;
      if (raw !== undefined && raw !== null && raw !== '') {
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed > 0) peso_gramas = parsed;
      }
    } catch (e) {
      console.warn('[produtos] ConsultaFormatoProduto falhou para', codigo, '—', e.message);
    }

    res.json({
      codigo:         (p['CD_PRO']           || '').trim(),
      descricao:      (p['DS_PRO']           || '').trim(),
      valor_unitario:  p['VL_VENDA_PRO']     || 0,
      estoque:         p['QT_EST_ATUAL_PRO'] || 0,
      unidade:        (p['UN_PRO']           || 'UN').trim(),
      ncm:            (p['NCM_PRO']          || '').trim(),
      sit_trib:       (p['SIT_TRIB_PRO']     || '').trim(),
      aliquota:       (p['ALIQUOTA_PRO']     || '').trim(),
      cst_icms:       (p['CD_CST_SAI_PRO']   || p['CD_CST_PRO'] || '').trim(),
      cst_pis:        (p['CST_PIS_SAI_PRO']  || '').trim(),
      cst_cofins:     (p['CST_COFINS_SAI_PRO']|| '').trim(),
      cfop:           (p['CFOP_SAI_SAT_PRO'] || '').trim(),
      peso_gramas,
    });
  } catch (e) {
    console.error('[produtos] GET /:codigo', e.message);
    res.status(500).json({ erro: 'Erro ao buscar produto' });
  }
});

// GET /api/produtos — listagem (opcional, útil para debug)
router.get('/', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT FIRST 500 CD_PRO, DS_PRO, VL_VENDA_PRO, QT_EST_ATUAL_PRO, UN_PRO
       FROM PRODUTO
       WHERE FL_ATIVO_PRO = 1
         AND (FL_NAOVENDER_PRO IS NULL OR FL_NAOVENDER_PRO = 0)
       ORDER BY DS_PRO`
    );
    res.json(rows.map(p => ({
      codigo:         (p['CD_PRO']  || '').trim(),
      descricao:      (p['DS_PRO']  || '').trim(),
      valor_unitario:  p['VL_VENDA_PRO']     || 0,
      estoque:         p['QT_EST_ATUAL_PRO'] || 0,
      unidade:        (p['UN_PRO']  || 'UN').trim(),
    })));
  } catch (e) {
    console.error('[produtos] GET /', e.message);
    res.status(500).json({ erro: 'Erro ao listar produtos' });
  }
});

/**
 * PATCH /api/produtos/:codigo/formato-pro
 * Salva o peso aprendido pela balança no campo FORMATO_PRO do produto.
 */
router.patch('/:codigo/formato-pro', async (req, res) => {
  try {
    const codigo = pad14(req.params.codigo)
    const peso   = parseInt(req.body?.peso_gramas, 10)
    if (!peso || peso <= 0) {
      return res.status(400).json({ erro: 'peso_gramas inválido' })
    }
    await gravaFormatoProduto(codigo, peso)
    console.log(`[produtos] FORMATO_PRO gravado via ERP: ${codigo} → ${peso}g`)
    res.json({ ok: true, codigo, peso_gramas: peso })
  } catch (e) {
    console.error('[produtos] PATCH /:codigo/formato-pro', e.message)
    res.status(500).json({ erro: 'Erro ao atualizar FORMATO_PRO' })
  }
})

module.exports = router;
