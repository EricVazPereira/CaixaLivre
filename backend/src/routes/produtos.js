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

/** Retorna true se o objeto retornado pelo ERP é um produto válido e ativo */
function produtoValido(p) {
  return p && p['fl_ativo'] !== '0' && p['cod_pro'];
}

/**
 * Gera as variantes de código a tentar no ERP, em ordem de prioridade:
 *  1. Exatamente como veio do leitor (sem modificação)
 *  2. Sem zeros à esquerda (ex.: "0789..." → "789...")
 *  3. Padded para 14 dígitos
 * Remove duplicatas para evitar chamadas repetidas.
 */
function variantesCodigo(rawParam) {
  const digits   = String(rawParam).replace(/\D/g, '')
  const sem14    = pad14(digits)                        // 14 dígitos
  const semZeros = digits.replace(/^0+/, '') || digits  // sem zeros à esquerda
  const raw      = digits                               // como digitado/lido
  // Mantém a ordem mas evita duplicatas
  return [...new Set([raw, semZeros, sem14])]
}

/**
 * GET /api/produtos/:codigo
 * Consulta produto via API do ERP.
 * Tenta múltiplas variantes do código para suportar EAN-13, EAN-14 e códigos internos.
 */
router.get('/:codigo', async (req, res) => {
  const variantes = variantesCodigo(req.params.codigo);
  let ultimoRaw   = null;
  let ultimoErro  = null;

  for (const cod of variantes) {
    try {
      const p = await consultaFormatoProduto(cod);
      console.log(`[produtos] ConsultaFormatoProduto(${cod}):`, JSON.stringify(p));
      ultimoRaw = p;

      if (!produtoValido(p)) continue; // tenta próxima variante

      const pesoRaw   = parseInt(p['formato_pro'], 10);
      const peso_gramas = !isNaN(pesoRaw) && pesoRaw > 0 ? pesoRaw : null;

      return res.json({
        codigo:          (p['cod_pro'] || '').trim(),
        descricao:       (p['ds_pro']  || '').trim(),
        valor_unitario:  parseBRL(p['vl_venda']),
        unidade:         (p['un_pro']  || 'UN').trim(),
        peso_gramas,
      });
    } catch (e) {
      ultimoErro = e.message;
      console.error(`[produtos] GET (${cod}):`, e.message);
    }
  }

  // Nenhuma variante encontrou o produto
  return res.status(404).json({
    erro: 'Produto não encontrado',
    _debug: { variantes, erp_raw: ultimoRaw, erp_erro: ultimoErro },
  });
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
