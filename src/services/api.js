import { normalizarCodigo } from '../utils/barcode'

const BASE = '/api'

export async function buscarProduto(codigo) {
  const cod = normalizarCodigo(codigo)
  const res = await fetch(`${BASE}/produtos/${encodeURIComponent(cod)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Erro ao buscar produto')
  return res.json()
}

export async function registrarConta({ forma_pagamento, itens, cd_operador }) {
  const res = await fetch(`${BASE}/contas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forma_pagamento, itens, cd_operador }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.erro || 'Erro ao registrar venda')
  }
  return res.json()
}

// ── Histórico (status / abertura / fechamento de caixa) ──────────────────────

/** Verifica se o caixa está aberto no ERP para este computador */
export async function verificarStatusCaixa() {
  const res = await fetch(`${BASE}/historico/status`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || 'Erro ao verificar status do caixa')
  return data // { aberto: bool, nm_estacao: string, id_historico: number|null }
}

/** Abre o caixa via ERP */
export async function abrirCaixa({ cod_operador = '0', cod_executor = '0' } = {}) {
  const res = await fetch(`${BASE}/historico/abrir-erp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cod_operador, cod_executor }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || 'Erro ao abrir caixa')
  return data // { ok: true, nm_estacao, id_historico, erp }
}

/**
 * Grava itens no ERP via grava_itens.
 *
 * @param {Object} opts
 * @param {string} [opts.id]      - ID da conta no ERP (vazio = ERP gera automaticamente)
 * @param {string} [opts.nrMesa]  - Número da mesa (vazio para totem)
 * @param {Array}  opts.consumo   - Lista de itens: { produto_codigo, quantidade, vl_unitario, obs? }
 */
export async function gravarItens({ id = '', nrMesa = '', consumo }) {
  const res = await fetch(`${BASE}/historico/grava-itens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, nrMesa, consumo }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || 'Erro ao gravar itens no ERP')
  return data // { ok: true, erp: ... }
}

/**
 * Fecha a comanda no ERP via FechamentoComandaSmartPDV.
 * @param {Object} opts
 * @param {string} opts.subtotal        - Soma dos itens
 * @param {string} opts.total           - Total a pagar
 * @param {string} opts.barcode         - NRGERADOR (barcode do GravaItens)
 * @param {string} opts.forma_pagamento - 'pix' | 'credito' | 'debito'
 * @param {string} [opts.cpf]           - CPF do cliente (opcional)
 */
export async function fecharComanda({ subtotal, total, barcode, forma_pagamento, cpf = '', discount = '0', add_service = '0' }) {
  const res = await fetch(`${BASE}/historico/fechar-comanda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtotal, total, barcode, forma_pagamento, cpf, discount, add_service }),
  })
  const text = await res.text().catch(() => '')
  let data = {}
  try { data = JSON.parse(text) } catch { console.error('[fecharComanda] Resposta não é JSON (HTTP', res.status, '):', text.slice(0, 300)) }
  if (!res.ok) throw new Error(data.erro || `Erro HTTP ${res.status} ao fechar comanda no ERP`)
  return data
}

/** Dispara impressão de página de teste na impressora configurada no TAB_PARAM */
export async function imprimirPaginaTeste() {
  try {
    const res = await fetch(`${BASE}/impressora/teste`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) console.warn('[Impressora]', data.motivo || data.erro)
    else console.log(`[Impressora] Página de teste enviada para "${data.impressora}"`)
  } catch (e) {
    console.warn('[Impressora] Falha ao comunicar com backend:', e.message)
  }
}

/**
 * Imprime o cupom/comprovante na impressora padrão.
 * Fire-and-forget — nunca lança, falha silenciosa para não bloquear a navegação.
 *
 * @param {Object} opts
 * @param {Array}  opts.itens           - Itens do carrinho
 * @param {string} opts.total           - Valor total (ex: "13.20")
 * @param {string} opts.forma_pagamento - 'pix' | 'credito' | 'debito'
 * @param {string} [opts.cpf]           - CPF do cliente (opcional)
 */
export async function imprimirCupom({ itens, total, forma_pagamento, cpf = '', chaveAcesso = '', protocolo = '', nfce = '', urlQrcode = '' }) {
  try {
    const res  = await fetch(`${BASE}/impressora/cupom`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ itens, total, forma_pagamento, cpf, chaveAcesso, protocolo, nfce, urlQrcode }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.ok) console.warn('[Impressora] Cupom —', data.erro || 'falha desconhecida')
    else          console.log('[Impressora] Cupom enviado para impressão ✓')
  } catch (e) {
    console.warn('[Impressora] Falha ao comunicar com backend:', e.message)
  }
}

/** Fecha o caixa via ERP (FechamentoCX) */
export async function fecharCaixa({ cod_executor = '0' } = {}) {
  const res = await fetch(`${BASE}/historico/fechar-erp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cod_executor }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || 'Erro ao fechar caixa no ERP')
  return data // { ok: true, mensagem, erp }
}

/** Valida o código geral (usuário GERAL do ERP) */
export async function validarCodigoGeral(codigo) {
  const res  = await fetch(`${BASE}/auth/validar-codigo-geral`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
  })
  const data = await res.json().catch(() => ({}))
  return data.ok === true
}

/**
 * Testa comunicação com a balança.
 * Retorna { habilitada, ok } — nunca lança.
 * Se habilitada=false, ok=true (balança ignorada por configuração).
 */
/**
 * Testa comunicação com a balança.
 * Retorna { habilitada, ok } — nunca lança.
 * Se habilitada=false, ok=true (balança ignorada por configuração).
 */
export async function testarBalanca() {
  try {
    const res  = await fetch(`${BASE}/balanca/teste`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json().catch(() => ({}))
    return { habilitada: data.habilitada ?? false, ok: data.ok === true }
  } catch {
    // Agente não respondeu — assume desabilitada para não bloquear o sistema
    return { habilitada: false, ok: false }
  }
}

/** Retorna configuração da balança: { habilitada } */
export async function buscarConfiguracaoBalanca() {
  try {
    const res  = await fetch(`${BASE}/balanca/config`)
    const data = await res.json().catch(() => ({}))
    return { habilitada: data.habilitada ?? false }
  } catch {
    // Agente não respondeu — assume desabilitada para não bloquear o sistema
    return { habilitada: false }
  }
}

/** Lê o peso atual da balança uma vez (retorna peso em gramas ou lança erro) */
export async function lerPesoBalanca() {
  const res  = await fetch(`${BASE}/balanca/peso`)
  const data = await res.json().catch(() => ({}))
  if (!data.ok) throw new Error(data.erro || 'Balança não respondeu')
  return data.peso_gramas
}

/**
 * Lê o peso atual aguardando estabilidade (sem exigir variação prévia).
 * Ideal para o check de total no pagamento.
 * Lança erro em caso de falha de comunicação.
 */
export async function lerPesoEstavelBalanca(timeoutMs = 5000, estabilidadeMs = 2000) {
  const res  = await fetch(
    `${BASE}/balanca/peso-estavel?timeout=${timeoutMs}&estabilidade=${estabilidadeMs}`,
    { signal: AbortSignal.timeout(timeoutMs + 3000) }
  )
  const data = await res.json().catch(() => ({}))
  if (data.desabilitada) return 0
  if (!data.ok) throw new Error(data.erro || 'Balança não respondeu')
  return data.peso_gramas
}

/**
 * Aguarda a balança atingir o peso esperado (dentro da tolerância).
 * @param {number} esperado     - Peso esperado em gramas
 * @param {number} tolerancia   - Tolerância em % (ex: 15)
 * @param {number} timeoutMs    - Tempo máximo em ms (ex: 12000)
 * @returns {{ ok, peso_gramas, timeout }}
 */
/**
 * Confere individualmente o peso do produto na balança.
 * O backend lê o baseline atual (o que já está lá) e verifica se subiu pelo delta.
 *
 * @param {number} delta      - Peso do produto (FORMATO_PRO), em gramas
 * @param {number} tolerancia - Tolerância em % (ex: 15)
 * @param {number} timeoutMs  - Tempo máximo em ms
 */
export async function aguardarPesoBalanca(delta, tolerancia = 15, timeoutMs = 12000) {
  const res  = await fetch(
    `${BASE}/balanca/aguardar?delta=${delta}&tolerancia=${tolerancia}&timeout=${timeoutMs}`,
    { signal: AbortSignal.timeout(timeoutMs + 3000) }
  )
  const data = await res.json().catch(() => ({}))
  return data
}

/**
 * Mede o peso do próximo item colocado na balança (para produtos sem FORMATO_PRO).
 * Retorna { ok, peso_gramas } ou { ok: false, sem_peso/sem_comunicacao }.
 */
export async function medirPesoBalanca(timeoutMs = 15000, estabilidadeMs = 2000) {
  try {
    const res  = await fetch(
      `${BASE}/balanca/medir?timeout=${timeoutMs}&estabilidade=${estabilidadeMs}`,
      { signal: AbortSignal.timeout(timeoutMs + 3000) }
    )
    const data = await res.json().catch(() => ({}))
    return data
  } catch {
    return { ok: false, sem_comunicacao: true }
  }
}

/**
 * Salva o peso aprendido pela balança no campo FORMATO_PRO do produto.
 * Nunca lança — falha silenciosa (o produto será medido de novo na próxima vez).
 */
export async function salvarFormatoPro(codigo, pesoGramas) {
  try {
    const res  = await fetch(`${BASE}/produtos/${encodeURIComponent(codigo)}/formato-pro`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ peso_gramas: pesoGramas }),
    })
    const data = await res.json().catch(() => ({}))
    return data.ok === true
  } catch {
    return false
  }
}

// Cancelamentos são apenas locais — o carrinho vive no frontend.
// Não há registro no banco para contas canceladas antes do pagamento.
export async function registrarCancelamento(_itens) {
  return Promise.resolve(null)
}

