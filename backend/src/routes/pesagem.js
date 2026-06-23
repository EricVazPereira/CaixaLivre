'use strict'
/**
 * pesagem.js — Famílias e produtos para pesagem no totem.
 * Fonte: GET /datasnap/rest/TSM/ConsultaCardapio
 *
 * A API retorna todos os itens em um único array.
 * Este módulo agrupa por família e filtra por un_pro === "KG".
 *
 * Cache em memória de 5 minutos para não sobrecarregar o ERP.
 *
 * GET /api/pesagem/familias
 *   → { ok, familias: [{ codigo, descricao }] }
 *
 * GET /api/pesagem/familias/:codigo/produtos
 *   → { ok, produtos: [{ codigo, descricao, valor_por_kg }] }
 */

const { Router }         = require('express')
const { consultaCardapio } = require('../erp')

const router = Router()

// ── Cache em memória ─────────────────────────────────────────────────────────

const cache = { itens: null, ts: 0 }
const CACHE_TTL = 5 * 60 * 1000  // 5 minutos

async function getCardapio() {
  const agora = Date.now()
  if (cache.itens && agora - cache.ts < CACHE_TTL) return cache.itens

  const raw = await consultaCardapio()
  const lista = Array.isArray(raw) ? raw : (raw?.result || [])

  // Normaliza cada item
  cache.itens = lista
    .filter(i => (i.un_pro || '').trim().toUpperCase() === 'KG')
    .map(i => ({
      cod_pro:      String(i.cod_pro    || '').trim(),
      ds_pro:       String(i.ds_pro     || '').trim(),
      cod_familia:  String(i.cod_familia ?? '').trim(),
      ds_familia:   String(i.ds_familia || '').trim(),
      cod_sfam:     String(i.cod_sfam   || '').trim(),
      ds_sfam:      String(i.ds_sfam    || '').trim(),
      valor_por_kg: parseFloat(String(i.preco_pro || '0').replace(',', '.')) || 0,
    }))
    .filter(i => i.cod_pro && i.valor_por_kg > 0)

  cache.ts = agora
  console.log(`[pesagem] Cardápio carregado: ${cache.itens.length} produtos pesáveis`)
  return cache.itens
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/pesagem/familias
 * Retorna famílias únicas dos produtos KG, ordenadas por descrição.
 */
router.get('/familias', async (_req, res) => {
  try {
    const itens = await getCardapio()

    const mapa = new Map()
    for (const item of itens) {
      if (!mapa.has(item.cod_familia)) {
        mapa.set(item.cod_familia, { codigo: item.cod_familia, descricao: item.ds_familia })
      }
    }

    const familias = [...mapa.values()].sort((a, b) => a.descricao.localeCompare(b.descricao))
    res.json({ ok: true, familias })
  } catch (e) {
    console.error('[pesagem] /familias —', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

/**
 * GET /api/pesagem/familias/:codigo/produtos
 * Retorna produtos de uma família, ordenados por descrição.
 */
router.get('/familias/:codigo/produtos', async (req, res) => {
  try {
    const itens    = await getCardapio()
    const produtos = itens
      .filter(i => i.cod_familia === req.params.codigo)
      .map(i => ({
        codigo:      i.cod_pro,
        descricao:   i.ds_pro,
        valor_por_kg: i.valor_por_kg,
      }))
      .sort((a, b) => a.descricao.localeCompare(b.descricao))

    res.json({ ok: true, produtos })
  } catch (e) {
    console.error('[pesagem] /familias/:codigo/produtos —', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

/**
 * GET /api/pesagem/buscar?q=termo
 * Busca textual em todos os produtos KG (usa cache).
 */
function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

router.get('/buscar', async (req, res) => {
  const q = normalizar(req.query.q || '').trim()
  if (q.length < 1) return res.json({ ok: true, produtos: [] })
  try {
    const itens    = await getCardapio()
    const produtos = itens
      .filter(i => normalizar(i.ds_pro).includes(q))
      .map(i => ({ codigo: i.cod_pro, descricao: i.ds_pro, valor_por_kg: i.valor_por_kg }))
      .sort((a, b) => a.descricao.localeCompare(b.descricao))
      .slice(0, 60)
    res.json({ ok: true, produtos })
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message })
  }
})

/**
 * POST /api/pesagem/invalidar-cache
 * Força recarga do cardápio na próxima requisição (útil após cadastrar novos produtos).
 */
router.post('/invalidar-cache', (_req, res) => {
  cache.itens = null; cache.ts = 0
  console.log('[pesagem] Cache invalidado.')
  res.json({ ok: true })
})

module.exports = router
