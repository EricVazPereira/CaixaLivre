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
export async function imprimirCupom({ itens, total, forma_pagamento, cpf = '', chaveAcesso = '', protocolo = '', nfce = '', urlQrcode = '', sitefData = null }) {
  try {
    const res  = await fetch(`${BASE}/impressora/cupom`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ itens, total, forma_pagamento, cpf, chaveAcesso, protocolo, nfce, urlQrcode, sitefData }),
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

/**
 * Verifica se o funcionário tem permissão para executar uma função no ERP.
 * @param {Object} opts
 * @param {string} opts.funcao   - Código da função (ex: "CANCEL_CONTA_CX_FUN")
 * @param {string} [opts.codigo] - Código do usuário (default "0")
 * @param {string} opts.senha    - Senha / PIN digitado pelo funcionário
 * @returns {{ ok: boolean, mensagem: string }}
 */
export async function verificarPermissao({ funcao, codigo = '0', senha }) {
  const res  = await fetch(`${BASE}/auth/verificar-permissao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ funcao, codigo, senha }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || 'Erro ao verificar permissão')
  return data // { ok: bool, mensagem: string }
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

/**
 * Força reconexão imediata da balança no agente.
 * Cancela timer de reconexão pendente e tenta abrir a porta serial agora.
 * Fire-and-forget — nunca lança.
 */
export async function reconectarBalanca() {
  try {
    await fetch(`${BASE}/balanca/reconectar`, { method: 'POST' })
  } catch { /* silently ignore */ }
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

/** Retorna configurações de runtime do backend (ex: sitefHabilitado) */
export async function buscarConfig() {
  try {
    const res  = await fetch(`${BASE}/config`)
    const data = await res.json().catch(() => ({}))
    return data
  } catch {
    return {}
  }
}

/**
 * Executa pagamento de cartão via ClientSiTef.
 * O servidor aguarda o cliente inserir o cartão (até 2 min).
 * O frontend deve exibir tela de "Aguardando cartão" enquanto espera.
 *
 * @param {Object} opts
 * @param {string|number} opts.idControle  - Nº controle único (ex: timestamp)
 * @param {string|number} opts.docFiscal   - Nº do cupom/barcode ERP
 * @param {number}        opts.valor       - Valor total (ex: 26.50)
 * @param {number}        [opts.parcelas]  - Parcelas (default 1)
 * @returns {{ aprovado, nomeProduto, nsuHost, codAutorizacao, finalizacao, linhasCupom, campos }}
 */
export async function realizarPagamentoCartao({ idControle, docFiscal, valor, parcelas = 1 }) {
  const res = await fetch(`${BASE}/sitef/crt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idControle, docFiscal, valor, parcelas }),
    signal: AbortSignal.timeout(160_000), // 2m40s — maior que o timeout do SiTef (2m30s)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || `Erro HTTP ${res.status} no SiTef`)
  return data
}

// Cancelamentos são apenas locais — o carrinho vive no frontend.
// Não há registro no banco para contas canceladas antes do pagamento.
export async function registrarCancelamento(_itens) {
  return Promise.resolve(null)
}

/**
 * Cancela uma conta/venda no ERP (CancelarConta).
 * @param {Object} opts
 * @param {string} opts.nr_gerador        - Barcode/NRGERADOR da conta
 * @param {string} [opts.valor_conta]     - Valor da conta (padrão "0")
 * @param {string} [opts.valor_acrescimo] - Valor de acréscimo (padrão "0")
 */
export async function cancelarConta({ nr_gerador, valor_conta = '0', valor_acrescimo = '0' }) {
  const res = await fetch(`${BASE}/contas/${encodeURIComponent(nr_gerador)}/cancelar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor_conta, valor_acrescimo }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || `Erro HTTP ${res.status} ao cancelar conta`)
  return data
}

/**
 * Cancela um item individual da conta no ERP (CancelarItem).
 * @param {Object} opts
 * @param {string} opts.nr_gerador  - NRGERADOR da conta (ex: "000741")
 * @param {string} opts.ordem_item  - Contador do item (ex: "0002")
 */
export async function cancelarItem({ nr_gerador, ordem_item }) {
  const res = await fetch(`${BASE}/contas/${encodeURIComponent(nr_gerador)}/cancelar-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordem_item }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.erro || `Erro HTTP ${res.status} ao cancelar item`)
  return data
}

