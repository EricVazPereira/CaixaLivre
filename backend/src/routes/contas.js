const { Router } = require('express');
const { query } = require('../db');
const { NM_ESTACAO } = require('../erp');

const router = Router();

const ESTACAO = NM_ESTACAO;

function mapStatus(stConta) {
  if (stConta === 'X') return 'paga';
  if (stConta === 'F') return 'cancelada';
  return 'aberta';
}

function mapForma(row) {
  if ((row['VL_CARTAO_CRE'] || 0) > 0) return 'credito';
  if ((row['VL_CARTAO_DEB'] || 0) > 0) return 'debito';
  if ((row['VL_DINHEIRO']   || 0) > 0) return 'pix';
  return null;
}

function fmtData(dt) {
  if (!dt) return '';
  try { return new Date(dt).toLocaleString('pt-BR'); } catch { return String(dt); }
}

// ── GET /api/contas — Lista vendas desta estação ─────────────────────────────

router.get('/', async (req, res) => {
  const comItens = req.query.itens === 'true';

  try {
    const rows = await query(
      `SELECT FIRST 5000
         c.ID_CONTA, c.ST_CONTA, c.DH_FECHAMENTO, c.DH_ABERTURA,
         c.VL_CONTA, c.VL_DINHEIRO, c.VL_CARTAO_CRE, c.VL_CARTAO_DEB,
         cs.ID_CONSUMO, cs.CD_PRODUTO, cs.QT_CONSUMO, cs.VL_CONSUMO,
         p.DS_PRO, p.UN_PRO
       FROM CONTA c
       LEFT JOIN CONSUMO cs ON cs.ID_CONTA = c.ID_CONTA
       LEFT JOIN PRODUTO p  ON p.CD_PRO    = cs.CD_PRODUTO
       WHERE c.NM_ESTACAO = '${ESTACAO}'
       ORDER BY c.ID_CONTA DESC, cs.ID_CONSUMO ASC`
    );

    const contasMap = new Map();
    for (const row of rows) {
      const id = row['ID_CONTA'];
      if (!contasMap.has(id)) {
        contasMap.set(id, {
          id,
          data_hora:       fmtData(row['DH_FECHAMENTO'] || row['DH_ABERTURA']),
          status:          mapStatus(row['ST_CONTA']),
          forma_pagamento: mapForma(row),
          valor_total:     row['VL_CONTA'] || 0,
          itens:           [],
        });
      }
      if (comItens && row['ID_CONSUMO'] != null) {
        const qtd = row['QT_CONSUMO'] || 1;
        const vlt = row['VL_CONSUMO'] || 0;
        contasMap.get(id).itens.push({
          id:             row['ID_CONSUMO'],
          descricao:     (row['DS_PRO']  || row['CD_PRODUTO'] || '').trim(),
          quantidade:     qtd,
          unidade:       (row['UN_PRO']  || 'UN').trim(),
          valor_unitario: Math.round((vlt / qtd) * 100) / 100,
          valor_total:    vlt,
        });
      }
    }

    res.json([...contasMap.values()]);
  } catch (e) {
    console.error('[contas] GET /', e.message);
    res.status(500).json({ erro: 'Erro ao buscar contas' });
  }
});

// ── GET /api/contas/:id — Detalhe de uma venda ───────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const rows = await query(
      `SELECT c.ID_CONTA, c.ST_CONTA, c.DH_FECHAMENTO, c.DH_ABERTURA,
              c.VL_CONTA, c.VL_DINHEIRO, c.VL_CARTAO_CRE, c.VL_CARTAO_DEB,
              cs.ID_CONSUMO, cs.CD_PRODUTO, cs.QT_CONSUMO, cs.VL_CONSUMO,
              p.DS_PRO, p.UN_PRO
       FROM CONTA c
       LEFT JOIN CONSUMO cs ON cs.ID_CONTA = c.ID_CONTA
       LEFT JOIN PRODUTO p  ON p.CD_PRO    = cs.CD_PRODUTO
       WHERE c.ID_CONTA = ?
       ORDER BY cs.ID_CONSUMO`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ erro: 'Conta não encontrada' });

    const r = rows[0];
    const conta = {
      id:              r['ID_CONTA'],
      data_hora:       fmtData(r['DH_FECHAMENTO'] || r['DH_ABERTURA']),
      status:          mapStatus(r['ST_CONTA']),
      forma_pagamento: mapForma(r),
      valor_total:     r['VL_CONTA'] || 0,
      itens:           [],
    };

    for (const row of rows) {
      if (row['ID_CONSUMO'] != null) {
        const qtd = row['QT_CONSUMO'] || 1;
        const vlt = row['VL_CONSUMO'] || 0;
        conta.itens.push({
          id:             row['ID_CONSUMO'],
          descricao:     (row['DS_PRO']  || row['CD_PRODUTO'] || '').trim(),
          quantidade:     qtd,
          unidade:       (row['UN_PRO']  || 'UN').trim(),
          valor_unitario: Math.round((vlt / qtd) * 100) / 100,
          valor_total:    vlt,
        });
      }
    }

    res.json(conta);
  } catch (e) {
    console.error('[contas] GET /:id', e.message);
    res.status(500).json({ erro: 'Erro ao buscar conta' });
  }
});

module.exports = router;
