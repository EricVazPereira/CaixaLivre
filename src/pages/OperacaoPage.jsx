import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import {
  buscarProduto, gravarItens,
  medirPesoBalanca, salvarFormatoPro, lerPesoEstavelBalanca,
  buscarConfiguracaoBalanca, reconectarBalanca,
  cancelarConta as cancelarContaAPI, verificarPermissao, cancelarItem,
  buscarConfiguracaoBalancaTotem, buscarConfig,
} from '../services/api'
import { normalizarCodigo } from '../utils/barcode'
import IconBalanca from '../components/IconBalanca'
import IconBalancaTotem from '../components/IconBalancaTotem'
import PesagemPage from './PesagemPage'
import './OperacaoPage.css'

/** Converte erros de rede (mensagens do browser em inglês) em texto amigável. */
function mensagemErro(err) {
  const msg = err?.message || ''
  if (
    msg === 'Failed to fetch' ||
    msg.includes('NetworkError') ||
    msg.includes('network') ||
    msg.includes('ERR_CONNECTION') ||
    msg.includes('ECONNREFUSED')
  ) return 'Sem conexão com o servidor.'
  return msg || 'Erro de comunicação com o servidor.'
}

const TOLERANCIA_PESO    = 0.15   // 15%
const MAX_QTD_DETECTADA = 9       // máximo de unidades que o sistema sugere automaticamente

/** Verifica se pesoMedido corresponde a N × pesoUnitario (N ≥ 2) dentro da tolerância */
function detectarMultiplos(pesoMedido, pesoUnitario) {
  for (let n = 2; n <= MAX_QTD_DETECTADA; n++) {
    const esperado = pesoUnitario * n
    const diff = Math.abs(pesoMedido - esperado) / esperado
    if (diff <= TOLERANCIA_PESO) return n
  }
  return null
}
const ESPERA_UNITARIO_S  = 15       // segundos de espera para qty = 1
const ESPERA_MULTIPLO_S  = 60       // segundos de espera para qty > 1
const ESTAB_UNITARIO_MS  = 300      // estabilidade para qty = 1
const ESTAB_MULTIPLO_MS  = 5000     // estabilidade para qty > 1

function calcularParamsBalanca(qtd) {
  return qtd > 1
    ? { esperaS: ESPERA_MULTIPLO_S, estabMs: ESTAB_MULTIPLO_MS }
    : { esperaS: ESPERA_UNITARIO_S, estabMs: ESTAB_UNITARIO_MS }
}

export default function OperacaoPage() {
  const navigate = useNavigate()

  const [codigo, setCodigo]                     = useState('')
  const [erro, setErro]                         = useState('')
  const [carregando, setCarregando]             = useState(false)
  const [verificandoPeso, setVerificandoPeso]   = useState(false)
  const [aprendendoPeso, setAprendendoPeso]     = useState(false)
  const [pesandoEtiqueta, setPesandoEtiqueta]   = useState(false)
  const [contagemBalanca, setContagemBalanca]   = useState(0)
  const [verificandoTotal, setVerificandoTotal] = useState(false)
  const [modoExclusao, setModoExclusao]         = useState(false)

  // Quantidade: modal numérico → overlay "Passe o produto no leitor"
  const [quantidadePendente, setQuantidadePendente] = useState(1)
  const [modalQuantidade, setModalQuantidade]       = useState(false)
  const [digQuantidade, setDigQuantidade]           = useState('')
  const [modoPassarProduto, setModoPassarProduto]   = useState(false)
  const [contadorPassar, setContadorPassar]         = useState(15)


  // Modal de liberação por gerente (divergência de peso individual)
  const [modalLiberacao, setModalLiberacao]   = useState(false)
  const [produtoPendente, setProdutoPendente] = useState(null)
  // Autenticação de dois passos: código (passo 1) + senha (passo 2)
  const [etapaPin, setEtapaPin]               = useState('codigo')   // 'codigo' | 'senha'
  const [codigoOp, setCodigoOp]               = useState('')
  const [pinLiberacao, setPinLiberacao]       = useState('')
  const [erroPin, setErroPin]                 = useState('')
  const [validandoPin, setValidandoPin]       = useState(false)

  // Modal de divergência no total (aviso + opção de liberar com gerente)
  const [modalPesoTotal, setModalPesoTotal]       = useState(false)
  const [modoPinPesoTotal, setModoPinPesoTotal]   = useState(false)

  // Modal de digitação manual de código
  const [modalDigitarCodigo, setModalDigitarCodigo] = useState(false)
  const [codigoManual, setCodigoManual]             = useState('')

  // Modal de busca manual
  const [modalBusca, setModalBusca]               = useState(false)
  const [codigoBusca, setCodigoBusca]             = useState('')
  const [produtoEncontrado, setProdutoEncontrado] = useState(null)
  const [erroBusca, setErroBusca]                 = useState('')
  const [buscando, setBuscando]                   = useState(false)

  // Modal de autorização para cancelar conta
  const [modalAutorizarCancelamento, setModalAutorizarCancelamento] = useState(false)

  // Seleção múltipla de itens para cancelamento (Set de IDs)
  const [selecionadosCancelamento, setSelecionadosCancelamento] = useState(new Set())
  const [modalConfirmarBatch, setModalConfirmarBatch]           = useState(false)
  const [modalAuthBatch, setModalAuthBatch]                     = useState(false)

  // Modal de confirmação de cancelamento de conta
  const [modalCancelarConta, setModalCancelarConta] = useState(false)
  const [cancelando, setCancelando]               = useState(false)
  const [erroCancelar, setErroCancelar]           = useState('')

  const [balancaHabilitada,       setBalancaHabilitada]       = useState(true)

  // Produto sendo pesado na balança agora (exibido no overlay)
  const [produtoNaBalanca,    setProdutoNaBalanca]     = useState(null)
  const cancelarPesagemRef = useRef(false)

  // Modal de detecção automática de múltiplas unidades pela balança
  const [modalQtdDetectada,   setModalQtdDetectada]   = useState(false)
  const [qtdDetectada,        setQtdDetectada]         = useState(0)
  const [produtoQtdDetect,    setProdutoQtdDetect]     = useState(null)
  const [modoRemoverItens,    setModoRemoverItens]     = useState(false)
  const [cancelamentoLiberado,    setCancelamentoLiberado]    = useState(false)
  const [modalPesagem,            setModalPesagem]            = useState(false)
  const [verificandoBalanca,  setVerificandoBalanca]  = useState(false)
  const [erroBalanca,         setErroBalanca]         = useState('')
  const syncPendenteRef  = useRef(0)    // nº de gravarItens aguardando resposta do ERP
  const erroSyncRef      = useRef('')   // último erro do gravarItens (para diagnóstico)

  const inputRef       = useRef(null)
  const inputPassarRef = useRef(null)
  const modalInputRef  = useRef(null)
  const erpSessionId   = useRef('')
  const listaItensRef  = useRef(null)
  const pinCampoRef    = useRef(null)   // ref compartilhado p/ o botão-label de PIN ativo

  // Refs para o handler de teclado global ter acesso ao estado/funções mais recentes
  // (atribuídos no corpo do componente a cada render — padrão "latest ref")
  const pinStateRef    = useRef({})
  const pinHandlersRef = useRef({})
  // Buffer de teclas para leitura de código de barras nas telas de PIN
  const barcodeBufferRef = useRef('')

  const { erpBarcode, setErpBarcode, nextItemContador } = useCaixaStore()

  const {
    itens, itemSelecionado,
    adicionarItem, selecionarItem,
    cancelarItemSelecionado, cancelarItens,
    cancelarConta: cancelarContaStore, subtotal,
    atualizarContadorERP,
  } = useCarrinhoStore()

  const focarInput = useCallback((delay = 0) => {
    setTimeout(() => inputRef.current?.focus(), delay)
  }, [])

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus()
    buscarConfiguracaoBalanca()
      .then(cfg => {
        setBalancaHabilitada(cfg.habilitada)
        // Se a balança está habilitada, força reconexão imediata no agente.
        // Isso cancela qualquer timer de reconexão pendente (3-30s) e tenta
        // abrir a porta serial agora — evita "perdeu comunicação" após fluxos
        // de liberação gerencial onde o operador fica ~30s na tela de PIN.
        if (cfg.habilitada) reconectarBalanca()
      })
      .catch(() => { /* mantém true — falha na config não desabilita a balança */ })

    buscarConfig()
      .then(cfg => setCancelamentoLiberado(cfg.cancelamentoLiberado === true))
      .catch(() => {})
  }, [])

  // Focus overlay de quantidade quando abrir + timer de 15s
  useEffect(() => {
    if (!modoPassarProduto) { setContadorPassar(15); return }
    setTimeout(() => inputPassarRef.current?.focus(), 80)
    setContadorPassar(15)
    const tick = setInterval(() => {
      setContadorPassar(prev => {
        if (prev <= 1) {
          clearInterval(tick)
          setModoPassarProduto(false)
          setQuantidadePendente(1)
          setCodigo('')
          focarInput(80)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [modoPassarProduto, focarInput])

  // Focus modal de busca quando abrir; ao fechar, devolve foco ao leitor
  useEffect(() => {
    if (modalBusca) setTimeout(() => modalInputRef.current?.focus(), 80)
    else {
      setCodigoBusca(''); setProdutoEncontrado(null); setErroBusca('')
      focarInput(80)
    }
  }, [modalBusca, focarInput])

  useEffect(() => {
    if (!erpBarcode) erpSessionId.current = ''
  }, [erpBarcode])

  // Auto-retorno ao início após 1 min SEM INTERAÇÃO com carrinho vazio.
  // Qualquer evento do usuário (toque, teclado, mouse) reseta o contador.
  useEffect(() => {
    if (itens.length > 0) return

    let timer = setTimeout(() => navigate('/inicio'), 60_000)

    function resetar() {
      clearTimeout(timer)
      timer = setTimeout(() => navigate('/inicio'), 60_000)
    }

    const eventos = ['mousedown', 'touchstart', 'keydown', 'pointerdown']
    eventos.forEach(ev => document.addEventListener(ev, resetar, { passive: true }))

    return () => {
      clearTimeout(timer)
      eventos.forEach(ev => document.removeEventListener(ev, resetar))
    }
  }, [itens.length, navigate])

  // Scrolla a lista para o último item sempre que um novo produto é adicionado
  useEffect(() => {
    if (listaItensRef.current) {
      listaItensRef.current.scrollTop = listaItensRef.current.scrollHeight
    }
  }, [itens.length])

  // Clique em área neutra → foca input
  useEffect(() => {
    function handleDocClick(e) {
      if (!e.target.closest('button, input, .item-linha')) focarInput()
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [focarInput])

  // Blur no input → recoloca o foco automaticamente (exceto quando modal aberto)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    function onBlur() {
      // Se qualquer modal/overlay estiver aberto, não interfere
      const modalAberto =
        modalQuantidade || modoPassarProduto || modalDigitarCodigo ||
        modalBusca      || modalLiberacao    || modalPesoTotal      ||
        modalAutorizarCancelamento || modalConfirmarBatch || modalAuthBatch ||
        modalCancelarConta || modalPesagem || modalQtdDetectada || modoRemoverItens
      if (!modalAberto) setTimeout(() => inputRef.current?.focus(), 80)
    }
    el.addEventListener('blur', onBlur)
    return () => el.removeEventListener('blur', onBlur)
  }, [
    modalQuantidade, modoPassarProduto, modalDigitarCodigo,
    modalBusca, modalLiberacao, modalPesoTotal,
    modalAutorizarCancelamento, modalConfirmarBatch, modalAuthBatch,
    modalCancelarConta, modalPesagem,
  ])

  // Telas de PIN abertas → foca o botão-label do campo de PIN.
  // Sem isso, o scanner envia ao <input> do leitor e o handler ignora (e.target === INPUT).
  // Com foco num <button>, o keydown propaga pelo document e o handler de PIN funciona.
  // Quando todas as telas fecham, o foco volta ao input do leitor.
  const pinModalAberto = modalAutorizarCancelamento || modalLiberacao ||
                         (modalPesoTotal && modoPinPesoTotal) || modalAuthBatch
  useEffect(() => {
    if (pinModalAberto) {
      setTimeout(() => pinCampoRef.current?.focus(), 80)
    } else {
      focarInput(80)
    }
  }, [pinModalAberto, focarInput])


  // ── Registra produto no carrinho e no ERP ─────────────────────────────────
  function registrarProduto(produto) {
    const qtd = produto.quantidade || 1

    if (!produto.codigo) {
      console.error('[registrarProduto] Produto sem código:', JSON.stringify(produto))
      setErro('Produto sem código. Verifique o cadastro no ERP.')
      return
    }

    // Gera o ID aqui (antes de adicionarItem) para poder referenciar o item
    // após receber a resposta do GravaItens e atualizar o contador do ERP.
    const itemId  = produto.id || crypto.randomUUID()
    const contador = nextItemContador()
    adicionarItem({ ...produto, id: itemId, contador }, qtd)

    syncPendenteRef.current += 1

    gravarItens({
      id:      erpSessionId.current,   // vazio no primeiro item, barcode nos seguintes
      consumo: [{ produto_codigo: produto.codigo, quantidade: qtd, vl_unitario: produto.valor_unitario, obs: '' }],
    }).then(res => {
      const erp = res?.erp
      console.log('[GravaItens] resposta completa:', JSON.stringify(res))

      // Extrai o barcode tentando todos os nomes de campo conhecidos
      function extrairBarcode(obj) {
        if (!obj || typeof obj !== 'object') return null
        return obj.barcode     ??
               obj.BARCODE     ??
               obj.nrgerador   ??
               obj.NRGERADOR   ??
               obj.NR_GERADOR  ??
               obj.nr_gerador  ??
               obj.id          ??
               obj.ID          ??
               null
      }

      let barcode     = null
      let contadorERP = null

      if (Array.isArray(erp) && erp.length > 0) {
        barcode     = extrairBarcode(erp[0])
        contadorERP = erp[erp.length - 1]?.contador ?? null
      } else if (erp && typeof erp === 'object') {
        barcode = extrairBarcode(erp)
      }

      console.log('[GravaItens] barcode extraído:', barcode, '| erp:', JSON.stringify(erp))

      if (barcode) {
        erpSessionId.current = String(barcode)
        setErpBarcode(String(barcode))
      } else if (!erpSessionId.current) {
        console.warn('[GravaItens] Barcode não encontrado na resposta. Campos disponíveis:', erp ? Object.keys(erp) : 'null')
      }

      // Atualiza o contador real do ERP no item do carrinho (necessário para
      // a API de cancelamento de item usar a ordem_item correta).
      if (contadorERP) atualizarContadorERP(itemId, contadorERP)
      syncPendenteRef.current = Math.max(0, syncPendenteRef.current - 1)
    }).catch(err => {
      syncPendenteRef.current = Math.max(0, syncPendenteRef.current - 1)
      erroSyncRef.current = err.message
      console.error('[GravaItens] Falha na sincronização com ERP:', err.message)
      setErro(`Falha ao registrar no sistema: ${err.message}`)
    })
  }

  // ── Cancela itens no ERP (fire-and-forget) ────────────────────────────────
  // Chamado após autorização bem-sucedida, antes de atualizar o store.
  // Usa o contador real do ERP (preenchido pela resposta do GravaItens).
  function cancelarItensNoERP(ids) {
    if (!erpBarcode) return
    const idSet = new Set(ids)
    itens
      .filter(i => idSet.has(i.id) && i.contador)
      .forEach(i => {
        cancelarItem({ nr_gerador: erpBarcode, ordem_item: String(i.contador) })
          .then(() => console.log(`[cancelarItem] ✓ nr=${erpBarcode} ordem=${i.contador}`))
          .catch(e  => console.warn(`[cancelarItem] ✗ nr=${erpBarcode} ordem=${i.contador}: ${e.message}`))
      })
  }

  // ── Countdown visual ──────────────────────────────────────────────────────
  function iniciarContagem(segundos, setterFn) {
    setterFn(segundos)
    const id = setInterval(() => setterFn(c => Math.max(0, c - 1)), 1000)
    return id
  }

  // ── Mede peso na balança com countdown e limpeza de estado ───────────────
  async function medirComContagem(esperaS, estabMs, setModo) {
    cancelarPesagemRef.current = false
    setModo(true)
    const tick = iniciarContagem(esperaS, setContagemBalanca)
    try {
      return await medirPesoBalanca(esperaS * 1000, estabMs)
    } catch {
      return { ok: false, sem_comunicacao: true }
    } finally {
      clearInterval(tick)
      setModo(false)
      setContagemBalanca(0)
      setProdutoNaBalanca(null)
    }
  }

  function handleVoltarPesagem() {
    cancelarPesagemRef.current = true
    setVerificandoPeso(false)
    setAprendendoPeso(false)
    setPesandoEtiqueta(false)
    setContagemBalanca(0)
    setProdutoNaBalanca(null)
    setCodigo('')
    setQuantidadePendente(1)
    focarInput(100)
  }

  // ── Verifica total acumulado ──────────────────────────────────────────────
  // Retorna true se OK, false se diverge (e já abre o modal de aviso).
  function checarTotalAcumulado(pesoNaBalanca, totalEsperado) {
    if (!pesoNaBalanca || !totalEsperado || totalEsperado <= 0) return true
    const diff = Math.abs(pesoNaBalanca - totalEsperado) / totalEsperado
    console.log(`[balanca/total] balança=${pesoNaBalanca}g | esperado=${totalEsperado}g | diff=${(diff * 100).toFixed(1)}%`)
    if (diff > TOLERANCIA_PESO) { setModalPesoTotal(true); return false }
    return true
  }

  // ── Detecta e parseia etiqueta de balança ────────────────────────────────────
  // Formato: 2 | PPPPPP (6 dígitos, código produto c/ padding) | BBBBB (5 dígitos, centavos) [| X verificador]
  //   12 dígitos → sem dígito verificador
  //   13 dígitos → com dígito verificador (ignorado)
  // Exemplo: "231100000638" → codRaw="311000", preço=R$ 6,38
  // O código real (ex.: "3110") é descoberto via tentativas progressivas no ERP (ver handleCodigoSubmit)
  function parseEtiquetaBalanca(raw) {
    const digits = raw.replace(/\D/g, '')
    if ((digits.length !== 13 && digits.length !== 12) || !digits.startsWith('2')) return null
    const codRaw        = digits.substring(1, 7)                   // 6 dígitos brutos (com zeros de padding)
    const precocentavos = parseInt(digits.substring(7, 12), 10)   // 5 dígitos = centavos
    if (isNaN(precocentavos) || !codRaw || codRaw === '000000') return null
    console.log(`[etiqueta] codRaw="${codRaw}" preço=R$${(precocentavos/100).toFixed(2)} (raw="${digits}")`)
    return { codRaw, preco: precocentavos / 100 }
  }

  // ── Submit do código de barras ────────────────────────────────────────────
  async function handleCodigoSubmit(e, codigoOverride) {
    e?.preventDefault()

    const codigoAtual = codigoOverride !== undefined ? codigoOverride : codigo

    // Verifica etiqueta de balança antes de normalizar
    const etiqueta = parseEtiquetaBalanca(codigoAtual)

    if (!etiqueta) {
      const cod = normalizarCodigo(codigoAtual)
      if (!cod || cod === '00000000000000') return
    }

    setModoPassarProduto(false)
    setCarregando(true)
    setErro('')
    setCodigo('')

    try {
      let produto = null
      let etiquetaComCodigo = null

      if (etiqueta) {
        // Busca progressiva: "311000" → "31100" → "3110"
        // Códigos têm de 4 a 6 dígitos; para ao atingir 4 dígitos ou ao não ter mais zeros à direita
        let tentativa = etiqueta.codRaw  // ex.: "311000" (sempre 6 dígitos)
        while (tentativa.length >= 4) {
          const cod = normalizarCodigo(tentativa)
          if (cod && cod !== '00000000000000') {
            produto = await buscarProduto(cod)
            if (produto) {
              etiquetaComCodigo = { ...etiqueta, codigoProduto: tentativa }
              console.log(`[etiqueta] produto encontrado com código="${tentativa}"`)
              break
            }
          }
          // Remove um zero à direita e tenta de novo; se não terminar em zero, para
          if (!tentativa.endsWith('0')) break
          tentativa = tentativa.replace(/0$/, '')
        }
      } else {
        const cod = normalizarCodigo(codigoAtual)
        if (!cod || cod === '00000000000000') { setCarregando(false); return }
        produto = await buscarProduto(cod)
      }

      if (!produto) { setErro('Produto não cadastrado.'); return }

      // ── Etiqueta de balança ──────────────────────────────────────────────────
      // Produto pesado na loja antes do caixa — confia no rótulo, nunca pesa de novo.
      if (etiquetaComCodigo) {
        if (produto.unidade?.toUpperCase() === 'KG') {
          // Quantidade calculada pelo valor da etiqueta ÷ preço/kg do ERP
          const quantidade = parseFloat((etiquetaComCodigo.preco / produto.valor_unitario).toFixed(3))
          registrarProduto({ ...produto, quantidade, valor_unitario: produto.valor_unitario, peso_gramas: 1000 })
        } else {
          // UN com etiqueta + balança habilitada: mede o peso do item apenas para a
          // conferência do total acumulado — não salva no ERP nem aprende FORMATO_PRO.
          if (balancaHabilitada) {
            setCarregando(false)
            setProdutoNaBalanca({ ...produto, valor_unitario: etiquetaComCodigo.preco })
            const { esperaS, estabMs } = calcularParamsBalanca(1)
            const resultado = await medirComContagem(esperaS, estabMs, setPesandoEtiqueta)
            if (cancelarPesagemRef.current) return

            if (!resultado.ok) {
              if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
              return
            }

            const pesoMedido    = resultado.peso_gramas
            const totalEsperado = itens.filter(i => !i.cancelado).reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) + pesoMedido
            const produtoEtiqueta = { ...produto, quantidade: 1, valor_unitario: etiquetaComCodigo.preco, peso_gramas: pesoMedido }
            if (!checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)) {
              setProdutoPendente(produtoEtiqueta)  // registra só após autorização do gerente
            } else {
              registrarProduto(produtoEtiqueta)
            }
            return
          }

          // Balança desabilitada: registra sem peso (sem conferência de total)
          registrarProduto({ ...produto, quantidade: 1, valor_unitario: etiquetaComCodigo.preco })
        }
        return
      }

      const qtd = quantidadePendente
      const { esperaS, estabMs } = calcularParamsBalanca(qtd)

      // ── Produto COM peso cadastrado: verifica delta na balança ────────────
      if (balancaHabilitada && produto.peso_gramas > 0) {
        setCarregando(false)
        setProdutoNaBalanca(produto)
        const resultado = await medirComContagem(esperaS, estabMs, setVerificandoPeso)
        if (cancelarPesagemRef.current) return

        if (!resultado.ok) {
          setQuantidadePendente(1)
          if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
          return
        }

        const deltaEsperado = produto.peso_gramas * qtd
        const deltaReal     = resultado.peso_gramas
        const diff          = Math.abs(deltaReal - deltaEsperado) / deltaEsperado
        console.log(`[balanca] delta medido=${deltaReal}g | esperado=${deltaEsperado}g | diff=${(diff * 100).toFixed(1)}%`)

        setQuantidadePendente(1)
        if (diff <= TOLERANCIA_PESO) {
          // ── Peso bate: registra normalmente ──────────────────────────────────
          const totalEsperado = itens.filter(i => !i.cancelado).reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) + deltaEsperado
          const produtoOk = { ...produto, quantidade: qtd }
          if (!checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)) {
            setProdutoPendente(produtoOk)
          } else {
            registrarProduto(produtoOk)
          }
        } else if (qtd === 1) {
          // ── Divergência com qtd=1: verifica se é múltiplo de unidades ────────
          const multN = detectarMultiplos(deltaReal, produto.peso_gramas)
          if (multN) {
            // Balança detectou N unidades — pergunta ao usuário
            setProdutoQtdDetect({ ...produto })
            setQtdDetectada(multN)
            setModalQtdDetectada(true)
          } else {
            // Peso diverge mas não é múltiplo reconhecível — liberação gerente
            setProdutoPendente({ ...produto, quantidade: qtd })
            setModalLiberacao(true)
          }
        } else {
          // ── Divergência com qtd > 1 definida manualmente ─────────────────────
          setProdutoPendente({ ...produto, quantidade: qtd })
          setModalLiberacao(true)
        }
        return
      }

      // ── Produto SEM peso cadastrado: aprende pela balança ─────────────────
      if (balancaHabilitada) {
        setCarregando(false)
        setProdutoNaBalanca(produto)
        const resultado = await medirComContagem(esperaS, estabMs, setAprendendoPeso)
        if (cancelarPesagemRef.current) return

        if (!resultado.ok) {
          setQuantidadePendente(1)
          if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
          return
        }

        const pesoUnitario  = Math.round(resultado.peso_gramas / qtd)
        const totalEsperado = itens.filter(i => !i.cancelado).reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) + resultado.peso_gramas
        setQuantidadePendente(1)
        // _aprenderPeso sinaliza que FORMATO_PRO deve ser salvo após autorização
        const produtoAprendido = { ...produto, quantidade: qtd, peso_gramas: pesoUnitario, _aprenderPeso: true }
        if (!checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)) {
          setProdutoPendente(produtoAprendido)  // registra só após autorização do gerente
        } else {
          registrarProduto(produtoAprendido)
          salvarFormatoPro(produto.codigo, pesoUnitario)
            .then(ok => console.log(`[balanca] ${ok ? '✅' : '⚠️'} FORMATO_PRO ${produto.codigo} → ${pesoUnitario}g (${qtd}×)`))
        }
        return
      }

      // ── Balança desabilitada ──────────────────────────────────────────────
      setQuantidadePendente(1)
      registrarProduto({ ...produto, quantidade: qtd })

    } catch (err) {
      console.error('[handleCodigoSubmit] erro não tratado:', err)
      setErro(mensagemErro(err))
    } finally {
      setCarregando(false)
      setVerificandoPeso(false)
      setAprendendoPeso(false)
      setPesandoEtiqueta(false)
      focarInput(50)
    }
  }

  // ── Pagamento ─────────────────────────────────────────────────────────────
  async function handlePagamento() {
    if (itens.length === 0) { setErro('Nenhum produto adicionado.'); return }

    // Se ainda há sincronização pendente com o ERP, aguarda até 5s
    if (syncPendenteRef.current > 0) {
      setErro('Aguarde, sincronizando com o sistema…')
      const inicio = Date.now()
      while (syncPendenteRef.current > 0 && Date.now() - inicio < 5000) {
        await new Promise(r => setTimeout(r, 200))
      }
      setErro('')
    }

    // Se não há sessão ERP ainda, tenta criar agora com os itens do carrinho
    if (!erpSessionId.current) {
      const ativos = itens.filter(i => !i.cancelado)
      if (ativos.length === 0) { setErro('Nenhum produto adicionado.'); return }

      setErro('Sincronizando com o sistema…')
      try {
        const res = await gravarItens({
          id: '',
          consumo: ativos.map(i => ({
            produto_codigo: i.codigo,
            quantidade:     i.quantidade,
            vl_unitario:    i.valor_unitario,
            obs:            '',
          })),
        })
        const erp = res?.erp
        console.log('[Pagamento] resync ERP:', JSON.stringify(res))

        function extrairBarcode(obj) {
          if (!obj || typeof obj !== 'object') return null
          return obj.barcode ?? obj.BARCODE ?? obj.nrgerador ?? obj.NRGERADOR ??
                 obj.NR_GERADOR ?? obj.nr_gerador ?? obj.id ?? obj.ID ?? null
        }

        const barcode = Array.isArray(erp)
          ? extrairBarcode(erp[0])
          : extrairBarcode(erp)

        if (barcode) {
          erpSessionId.current = String(barcode)
          setErpBarcode(String(barcode))
          setErro('')
        } else {
          console.warn('[Pagamento] resync sem barcode. Campos:', erp ? Object.keys(erp) : 'null')
          setErro('Falha na sincronização com o sistema. Chame um atendente.')
          return
        }
      } catch (err) {
        console.error('[Pagamento] resync falhou:', err.message)
        setErro(`Falha na sincronização: ${err.message}`)
        return
      }
    }

    if (balancaHabilitada) {
      const totalEsperado = itens.filter(i => !i.cancelado).reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0)
      if (totalEsperado > 0) {
        setVerificandoTotal(true)
        try {
          // Leitura estável (aguarda 2s sem variação) para evitar leitura em oscilação
          const pesoAtual = await lerPesoEstavelBalanca(6000, 2000)
          const diff = Math.abs(pesoAtual - totalEsperado) / totalEsperado
          console.log(`[balanca/pagamento] balança=${pesoAtual}g | esperado=${totalEsperado}g | diff=${(diff * 100).toFixed(1)}%`)
          if (diff > TOLERANCIA_PESO) { setModalPesoTotal(true); return }
        } catch (e) {
          console.warn('[balanca] Erro ao verificar total no pagamento:', e.message)
          setErro('Falha de comunicação com a balança. Chame um atendente.')
          return
        } finally {
          setVerificandoTotal(false)
        }
      }
    }

    navigate('/pagamento', { state: { autoConfirmar: true } })
  }

  // ── Abre modal de autorização para cancelar conta ────────────────────────
  function abrirAutorizacaoCancelamento() {
    if (cancelamentoLiberado) {
      // Sem autorização — abre direto o modal de confirmação
      setErroCancelar('')
      setModalCancelarConta(true)
      return
    }
    resetarPin()
    setModalAutorizarCancelamento(true)
  }

  // ── Confirma N unidades detectadas pela balança ──────────────────────────
  function handleConfirmarQtdDetectada() {
    if (!produtoQtdDetect) return
    const totalEsperado = itens.filter(i => !i.cancelado)
      .reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) +
      produtoQtdDetect.peso_gramas * qtdDetectada
    const produtoOk = { ...produtoQtdDetect, quantidade: qtdDetectada }
    setModalQtdDetectada(false)
    if (!checarTotalAcumulado(undefined, totalEsperado)) {
      setProdutoPendente(produtoOk)
    } else {
      registrarProduto(produtoOk)
    }
    setProdutoQtdDetect(null)
    focarInput(100)
  }

  // ── Usuário optou por não confirmar as múltiplas unidades — volta sem registrar ──
  function handleCancelarQtdDetectada() {
    setModalQtdDetectada(false)
    setQtdDetectada(0)
    setProdutoQtdDetect(null)
    setCodigo('')
    focarInput(100)
  }

  // ── Usuário quer remover itens extras e registrar 1 unidade ──────────────
  async function handleRemoverItensExtras() {
    setModalQtdDetectada(false)
    setModoRemoverItens(true)
    if (produtoQtdDetect) setProdutoNaBalanca(produtoQtdDetect)
    // Aguarda balança estabilizar em ~1 unidade (máx 15s)
    const { esperaS, estabMs } = calcularParamsBalanca(1)
    const resultado = await medirComContagem(esperaS, estabMs, setVerificandoPeso)
    setModoRemoverItens(false)
    if (!resultado.ok || !produtoQtdDetect) {
      setProdutoQtdDetect(null)
      focarInput(100)
      return
    }
    const deltaReal     = resultado.peso_gramas
    const deltaEsperado = produtoQtdDetect.peso_gramas
    const diff = Math.abs(deltaReal - deltaEsperado) / deltaEsperado
    if (diff <= TOLERANCIA_PESO) {
      // Agora está com 1 unidade — registra
      registrarProduto({ ...produtoQtdDetect, quantidade: 1 })
    } else {
      // Ainda diverge — vai para liberação
      setProdutoPendente({ ...produtoQtdDetect, quantidade: 1 })
      setModalLiberacao(true)
    }
    setProdutoQtdDetect(null)
    focarInput(100)
  }

  // ── Passo 2: verifica permissão e abre confirmação ────────────────────────
  async function handleLiberarCancelamentoConta() {
    if (!pinLiberacao) { setErroPin('Digite a senha.'); return }
    setValidandoPin(true)
    setErroPin('')
    try {
      const permissao = await verificarPermissao({ funcao: 'CANCEL_CONTA_CX_FUN', codigo: codigoOp, senha: pinLiberacao })
      if (permissao.ok) {
        setModalAutorizarCancelamento(false)
        resetarPin()
        setErroCancelar('')
        setModalCancelarConta(true)
      } else {
        setErroPin(permissao.mensagem && /permiss|localiz|desabilit|usuário/i.test(permissao.mensagem)
          ? sentenceCase(permissao.mensagem)
          : 'Código ou senha inválidos.')
        setCodigoOp('')
        setPinLiberacao('')
        setEtapaPin('codigo')
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  // ── Confirmar cancelamento de conta ──────────────────────────────────────
  async function handleConfirmarCancelamento() {
    setCancelando(true)
    setErroCancelar('')
    try {
      if (erpBarcode) {
        await cancelarContaAPI({ nr_gerador: erpBarcode })
      }
      cancelarContaStore()
      setErpBarcode('')
      setModalCancelarConta(false)
      navigate('/inicio')
    } catch (e) {
      setErroCancelar(e.message)
    } finally {
      setCancelando(false)
    }
  }

  function resetarPin() {
    setEtapaPin('codigo')
    setCodigoOp('')
    setPinLiberacao('')
    setErroPin('')
    barcodeBufferRef.current = ''
  }

  function fecharModalPesoTotal() {
    setModalPesoTotal(false)
    setModoPinPesoTotal(false)
    resetarPin()
    focarInput(80)
  }

  function fecharModalLiberacao() {
    setModalLiberacao(false)
    setProdutoPendente(null)
    resetarPin()
    focarInput(100)
  }

  // ── Passo 1: avança para o campo de senha (validação acontece no passo 2 via ERP) ──
  function handleConfirmarCodigo() {
    if (!codigoOp) { setErroPin('Digite o código do operador.'); return }
    setErroPin('')
    setEtapaPin('senha')
  }

  // ── Passo 2a: verifica permissão no ERP e libera produto (peso individual) ──
  async function handleLiberarConta() {
    if (!pinLiberacao) { setErroPin('Digite a senha.'); return }
    setValidandoPin(true)
    setErroPin('')
    try {
      const permissao = await verificarPermissao({ funcao: 'OPERA_CX_FUN', codigo: codigoOp, senha: pinLiberacao })
      if (permissao.ok) {
        registrarProduto(produtoPendente)
        setModalLiberacao(false)
        setProdutoPendente(null)
        resetarPin()
        focarInput(100)
      } else {
        setErroPin(permissao.mensagem && /permiss|localiz|desabilit|usuário/i.test(permissao.mensagem)
          ? sentenceCase(permissao.mensagem)
          : 'Código ou senha inválidos.')
        setCodigoOp('')
        setPinLiberacao('')
        setEtapaPin('codigo')
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  // ── Passo 2b: verifica permissão e libera divergência de total ──────────────
  // Se há produtoPendente: veio de um scan → registra o produto e volta ao leitor.
  // Se não há produtoPendente: veio do botão Pagamento → navega para pagamento.
  async function handleLiberarPesoTotal() {
    if (!pinLiberacao) { setErroPin('Digite a senha.'); return }
    setValidandoPin(true)
    setErroPin('')
    try {
      const permissao = await verificarPermissao({ funcao: 'OPERA_CX_FUN', codigo: codigoOp, senha: pinLiberacao })
      if (permissao.ok) {
        setModalPesoTotal(false)
        setModoPinPesoTotal(false)
        resetarPin()
        if (produtoPendente) {
          if (produtoPendente._aprenderPeso) {
            salvarFormatoPro(produtoPendente.codigo, produtoPendente.peso_gramas)
              .then(ok => console.log(`[balanca] ${ok ? '✅' : '⚠️'} FORMATO_PRO ${produtoPendente.codigo} → ${produtoPendente.peso_gramas}g`))
          }
          registrarProduto(produtoPendente)
          setProdutoPendente(null)
          focarInput(100)
        } else {
          navigate('/pagamento')
        }
      } else {
        setErroPin(permissao.mensagem && /permiss|localiz|desabilit|usuário/i.test(permissao.mensagem)
          ? sentenceCase(permissao.mensagem)
          : 'Código ou senha inválidos.')
        setCodigoOp('')
        setPinLiberacao('')
        setEtapaPin('codigo')
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  // ── Gerente ───────────────────────────────────────────────────────────────
  const PIN_KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫']
  const sentenceCase = s => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s

  // ── Itens ─────────────────────────────────────────────────────────────────
  function handleItemClick(item) {
    if (modoExclusao) {
      if (item.cancelado) return
      setSelecionadosCancelamento(prev => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
    } else if (itemSelecionado === item.id) {
      selecionarItem(null)
    } else {
      selecionarItem(item.id)
    }
  }

  function handleCancelarItemClick() {
    setSelecionadosCancelamento(new Set())
    setErro('')
    if (cancelamentoLiberado) {
      // Sem exigência de auth — entra direto no modo de seleção
      setModoExclusao(true)
    } else {
      // Pede autorização antes de mostrar os itens para cancelar
      resetarPin()
      setModalAuthBatch(true)
    }
  }

  function handleSairModoExclusao() {
    setModoExclusao(false)
    setSelecionadosCancelamento(new Set())
  }

  function handleAbrirConfirmarBatch() {
    if (selecionadosCancelamento.size === 0) return
    setModalConfirmarBatch(true)
  }

  function handleConfirmarBatch() {
    setModalConfirmarBatch(false)
    // Autorização já foi feita ao entrar no modo de seleção — cancela direto
    cancelarItensNoERP([...selecionadosCancelamento])
    cancelarItens([...selecionadosCancelamento])
    setSelecionadosCancelamento(new Set())
    setModoExclusao(false)
    focarInput(100)
  }

  async function handleLiberarCancelamentoItens() {
    if (!pinLiberacao) { setErroPin('Digite a senha.'); return }
    setValidandoPin(true)
    setErroPin('')
    try {
      const permissao = await verificarPermissao({
        funcao: 'CANCEL_ITEM_CX_FUN',
        codigo: codigoOp,
        senha:  pinLiberacao,
      })
      if (!permissao.ok) {
        setErroPin(permissao.mensagem && /permiss|localiz|desabilit|usuário/i.test(permissao.mensagem)
          ? sentenceCase(permissao.mensagem)
          : 'Código ou senha inválidos.')
        setCodigoOp(''); setPinLiberacao(''); setEtapaPin('codigo')
        return
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
      return
    } finally {
      setValidandoPin(false)
    }
    // Autorizado — entra no modo de seleção de itens
    setModalAuthBatch(false)
    setModoExclusao(true)
    resetarPin()
  }

  // ── Autenticação via código de barras de permissão ───────────────────────
  // Formato lido pelo scanner: {codigo}|{senha}|
  // Autentica em um passo só, sem passar pelo numpad manual.
  async function handleBarcodePermissao(codigo, senha) {
    // Exibe os valores nos campos para feedback visual
    setCodigoOp(codigo)
    setPinLiberacao(senha)
    setEtapaPin('senha')
    setValidandoPin(true)
    setErroPin('')
    // Determina a funcao conforme o modal aberto
    const funcaoBarcode = modalAuthBatch
      ? 'CANCEL_ITEM_CX_FUN'
      : modalAutorizarCancelamento
        ? 'CANCEL_CONTA_CX_FUN'
        : 'OPERA_CX_FUN' // modalLiberacao e modalPesoTotal
    try {
      const permissao = await verificarPermissao({ funcao: funcaoBarcode, codigo, senha })
      if (permissao.ok) {
        if (modalAutorizarCancelamento) {
          setModalAutorizarCancelamento(false)
          resetarPin()
          setErroCancelar('')
          setModalCancelarConta(true)
        } else if (modalLiberacao) {
          registrarProduto(produtoPendente)
          setModalLiberacao(false)
          setProdutoPendente(null)
          resetarPin()
          focarInput(100)
        } else if (modalAuthBatch) {
          // Autorizado via barcode — entra no modo de seleção de itens
          setModalAuthBatch(false)
          setModoExclusao(true)
          resetarPin()
        } else if (modalPesoTotal && modoPinPesoTotal) {
          setModalPesoTotal(false)
          setModoPinPesoTotal(false)
          resetarPin()
          if (produtoPendente) {
            if (produtoPendente._aprenderPeso) {
              salvarFormatoPro(produtoPendente.codigo, produtoPendente.peso_gramas)
                .then(ok => console.log(`[balanca] ${ok ? '✅' : '⚠️'} FORMATO_PRO ${produtoPendente.codigo} → ${produtoPendente.peso_gramas}g`))
            }
            registrarProduto(produtoPendente)
            setProdutoPendente(null)
            focarInput(100)
          } else {
            navigate('/pagamento')
          }
        }
      } else {
        setErroPin(permissao.mensagem && /permiss|localiz|desabilit|usuário/i.test(permissao.mensagem)
          ? sentenceCase(permissao.mensagem)
          : 'Código ou senha inválidos.')
        setCodigoOp('')
        setPinLiberacao('')
        setEtapaPin('codigo')
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  // ── Busca manual ──────────────────────────────────────────────────────────
  async function handleBuscaSubmit(e) {
    e.preventDefault()
    const cod = normalizarCodigo(codigoBusca)
    if (!cod || cod === '00000000000000') return
    setBuscando(true)
    setErroBusca('')
    setProdutoEncontrado(null)
    try {
      const produto = await buscarProduto(cod)
      if (!produto) setErroBusca(`Produto não encontrado: ${cod}`)
      else setProdutoEncontrado(produto)
    } catch (err) {
      setErroBusca(mensagemErro(err))
    } finally {
      setBuscando(false)
      setCodigoBusca('')
      setTimeout(() => modalInputRef.current?.focus(), 50)
    }
  }

  function handleAdicionarProduto() {
    if (!produtoEncontrado) return
    const codigo = produtoEncontrado.codigo
    setModalBusca(false)
    // Passa pelo fluxo normal (balança, conferência de peso, etc.)
    setTimeout(() => handleCodigoSubmit(null, codigo), 80)
  }

  const total = subtotal()

  // ── Atualiza refs "latest" a cada render ──────────────────────────────────
  // Permite que o useEffect abaixo (registrado uma vez) leia sempre valores frescos
  pinStateRef.current = {
    validandoPin, etapaPin, codigoOp, pinLiberacao,
    modalAutorizarCancelamento, modalLiberacao,
    modalPesoTotal, modoPinPesoTotal, modalAuthBatch,
    modalConfirmarBatch, modalCancelarConta, cancelando,
    modalQuantidade, digQuantidade,
  }
  pinHandlersRef.current = {
    handleConfirmarCodigo,
    handleLiberarCancelamentoConta,
    handleLiberarConta,
    handleLiberarPesoTotal,
    handleLiberarCancelamentoItens,
    handleConfirmarBatch,
    handleConfirmarCancelamento,
    handleBarcodePermissao,
  }

  // ── Teclado global: Enter confirma PIN; leitor de barras autentica direto ──
  // Registrado uma vez. Estado/funções lidos via refs (padrão "latest ref").
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    function onKeyDown(e) {
      // Nunca intercepta campos reais de texto
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      const s = pinStateRef.current
      const h = pinHandlersRef.current

      const pinAberto = s.modalAutorizarCancelamento || s.modalLiberacao
                      || (s.modalPesoTotal && s.modoPinPesoTotal) || s.modalAuthBatch

      // ── Modais de PIN: acumula teclado para leitura de código de barras ──
      if (pinAberto) {
        if (e.key.length === 1) {
          // Caractere printável (inclui dígitos, '|', letras) → vai para o buffer
          barcodeBufferRef.current += e.key
          return
        }

        if (e.key === 'Enter') {
          e.preventDefault()
          const buf = barcodeBufferRef.current
          barcodeBufferRef.current = ''

          // Normaliza separador: leitores US-layout enviam '}' onde o barcode tem '|'
          const normalized = buf.replace(/}/g, '|')
          // Tenta interpretar como barcode de permissão: {codigo}|{senha}[|]
          const m = normalized.match(/^([^|]+)\|([^|]+)\|?$/)
          if (m && !s.validandoPin) {
            h.handleBarcodePermissao(m[1], m[2])
            return
          }

          // Buffer vazio ou não é barcode → Enter manual (numpad)
          if (s.validandoPin) return
          if (s.etapaPin === 'codigo') {
            h.handleConfirmarCodigo()
          } else if (s.modalAutorizarCancelamento) {
            h.handleLiberarCancelamentoConta()
          } else if (s.modalLiberacao) {
            h.handleLiberarConta()
          } else if (s.modalAuthBatch) {
            h.handleLiberarCancelamentoItens()
          } else {
            h.handleLiberarPesoTotal()
          }
        }
        // Qualquer outra tecla especial (Shift, Tab…) é ignorada
        return
      }

      // ── Fora dos modais de PIN: só processa Enter ──
      if (e.key !== 'Enter') return

      // ── Confirmação de cancelamento em lote ──
      if (s.modalConfirmarBatch) {
        e.preventDefault()
        h.handleConfirmarBatch()
        return
      }

      // ── Confirmação de cancelamento de conta ──
      if (s.modalCancelarConta && !s.cancelando) {
        e.preventDefault()
        h.handleConfirmarCancelamento()
        return
      }

      // ── Modal de quantidade ──
      if (s.modalQuantidade) {
        e.preventDefault()
        const q = parseInt(s.digQuantidade)
        if (q >= 1) {
          const qty = Math.max(1, q)
          setQuantidadePendente(qty)
          setModalQuantidade(false)
          setDigQuantidade('')
          if (qty > 1) setModoPassarProduto(true)
          else focarInput(80)
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [focarInput]) // focarInput é useCallback — estável; todo o resto vem via refs

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="operacao-root">

      {/* ── Overlay: Autorização para cancelar conta ── */}
      {modalAutorizarCancelamento && (
        <div className="instrucao-overlay instrucao-overlay--liberacao">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--liberacao">
              <iconify-icon icon="tabler:shield-check" />
            </div>

            <h2 className="instrucao-titulo">Confirmação do gerente</h2>
            <p className="instrucao-sub">
              {etapaPin === 'codigo' ? 'Digite o código do operador.' : 'Digite a senha do operador.'}
            </p>

            <button type="button" ref={pinCampoRef} className="autorizacao-campo autorizacao-campo--ativo" disabled={validandoPin}>
              <span
                key={etapaPin}
                className={`autorizacao-campo-valor${(etapaPin === 'codigo' ? codigoOp : pinLiberacao).length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
              >
                {etapaPin === 'codigo'
                  ? (codigoOp.length > 0 ? codigoOp : 'Código')
                  : (pinLiberacao.length > 0 ? '●'.repeat(pinLiberacao.length) : 'Senha')}
              </span>
            </button>

            <div className="liberacao-numpad">
              <div className="numpad-grid">
                {PIN_KEYS.map((key, i) => (
                  key === '' ? <div key={i} /> :
                  <button
                    key={key + i}
                    type="button"
                    className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                    onClick={() => {
                      if (etapaPin === 'codigo') {
                        if (key === '⌫') setCodigoOp(p => p.slice(0, -1))
                        else if (codigoOp.length < 10) setCodigoOp(p => p + key)
                      } else {
                        if (key === '⌫') setPinLiberacao(p => p.slice(0, -1))
                        else if (pinLiberacao.length < 10) setPinLiberacao(p => p + key)
                      }
                    }}
                    disabled={validandoPin}
                  >
                    {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
                  </button>
                ))}
              </div>
            </div>

            {erroPin && (
              <div className="autorizacao-erro">
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
                {erroPin}
              </div>
            )}

            <div className="autorizacao-btns">
              <button
                type="button"
                className="btn-fenix btn-dark btn-modal"
                onClick={etapaPin === 'codigo'
                  ? () => { setModalAutorizarCancelamento(false); resetarPin() }
                  : () => { setEtapaPin('codigo'); setPinLiberacao(''); setErroPin('') }}
                disabled={validandoPin}
              >
                <iconify-icon icon="tabler:arrow-left" />
                Voltar
              </button>
              <button
                type="button"
                className="btn-fenix btn-orange btn-modal"
                onClick={etapaPin === 'codigo' ? handleConfirmarCodigo : handleLiberarCancelamentoConta}
                disabled={(etapaPin === 'codigo' ? !codigoOp : !pinLiberacao) || validandoPin}
              >
                <iconify-icon icon="tabler:shield-check" />
                {validandoPin ? 'Validando…' : 'Confirmar'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Overlay: Confirmar cancelamento de conta ── */}
      {modalCancelarConta && (
        <div className="instrucao-overlay instrucao-overlay--alerta">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--alerta instrucao-icone--shake">
              <iconify-icon icon="tabler:circle-x" />
            </div>

            <h2 className="instrucao-titulo">Cancelar conta?</h2>

            <p className="instrucao-sub">
              Esta ação não pode ser desfeita.
            </p>

            {erroCancelar && (
              <div className="autorizacao-erro">
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
                {erroCancelar}
              </div>
            )}

            <div className="autorizacao-btns">
              <button
                type="button"
                className="btn-fenix btn-dark btn-modal"
                onClick={() => { setModalCancelarConta(false); setErroCancelar('') }}
                disabled={cancelando}
                style={{ width: 'auto', flexShrink: 0, paddingInline: '1.5rem' }}
              >
                <iconify-icon icon="tabler:arrow-left" />
                Manter compra
              </button>
              <button
                type="button"
                className="btn-fenix btn-red btn-modal"
                onClick={handleConfirmarCancelamento}
                disabled={cancelando}
                aria-busy={cancelando}
                style={{ flex: 1, width: 'auto', minWidth: 'max-content', paddingInline: '1.5rem' }}
              >
                {cancelando
                  ? <iconify-icon icon="tabler:loader-2" class="spin" />
                  : <iconify-icon icon="tabler:circle-x" />
                }
                {cancelando ? 'Cancelando…' : `Cancelar conta de R$ ${total.toFixed(2).replace('.', ',')}`}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Overlay: Passe o produto no leitor ── */}
      {modoPassarProduto && (
        <div
          className="modal-overlay modal-passar-overlay"
          onClick={e => {
            if (e.target === e.currentTarget) {
              setModoPassarProduto(false)
              setQuantidadePendente(1)
              setCodigo('')
              focarInput(80)
            }
          }}
        >
          <div className="modal-passar-card" onClick={e => e.stopPropagation()}>

            <span className="modal-passar-timer label-mono">{contadorPassar}s</span>

            <div className="modal-passar-qty">
              <span>{quantidadePendente}×</span>
            </div>

            <h2 className="modal-passar-titulo">Passe o produto no leitor</h2>

            <form onSubmit={handleCodigoSubmit} style={{ width: '100%' }}>
              <input
                ref={inputPassarRef}
                type="text"
                value={codigo}
                onChange={e => setCodigo(e.target.value)}
                placeholder="Aguardando leitura…"
                className="barcode-input barcode-input--large"
                autoComplete="off"
                disabled={carregando}
              />
            </form>

            <button
              type="button"
              className="btn-fenix btn-dark btn-modal"
              style={{ width: '100%' }}
              onClick={() => {
                setModoPassarProduto(false)
                setQuantidadePendente(1)
                setCodigo('')
                focarInput(80)
              }}
            >
              <iconify-icon icon="tabler:x" />
              Fechar
            </button>

          </div>
        </div>
      )}

      {/* ── Overlay: Liberação por gerente ── */}
      {modalLiberacao && (
        <div className="instrucao-overlay instrucao-overlay--liberacao">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--liberacao">
              <iconify-icon icon="tabler:alert-triangle" />
            </div>

            <h2 className="instrucao-titulo">Confirmação do gerente</h2>
            <p className="instrucao-sub">
              {etapaPin === 'codigo' ? 'Digite o código do operador.' : 'Digite a senha do operador.'}
            </p>

            <button type="button" ref={pinCampoRef} className="autorizacao-campo autorizacao-campo--ativo" disabled={validandoPin}>
              <span
                key={etapaPin}
                className={`autorizacao-campo-valor${(etapaPin === 'codigo' ? codigoOp : pinLiberacao).length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
              >
                {etapaPin === 'codigo'
                  ? (codigoOp.length > 0 ? codigoOp : 'Código')
                  : (pinLiberacao.length > 0 ? '●'.repeat(pinLiberacao.length) : 'Senha')}
              </span>
            </button>

            <div className="liberacao-numpad">
              <div className="numpad-grid">
                {PIN_KEYS.map((key, i) => (
                  key === '' ? <div key={i} /> :
                  <button
                    key={key + i}
                    type="button"
                    className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                    onClick={() => {
                      if (etapaPin === 'codigo') {
                        if (key === '⌫') setCodigoOp(p => p.slice(0, -1))
                        else if (codigoOp.length < 10) setCodigoOp(p => p + key)
                      } else {
                        if (key === '⌫') setPinLiberacao(p => p.slice(0, -1))
                        else if (pinLiberacao.length < 10) setPinLiberacao(p => p + key)
                      }
                    }}
                    disabled={validandoPin}
                  >
                    {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
                  </button>
                ))}
              </div>
            </div>

            {erroPin && (
              <div className="autorizacao-erro">
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
                {erroPin}
              </div>
            )}

            <div className="autorizacao-btns">
              <button
                type="button"
                className="btn-fenix btn-dark btn-modal"
                onClick={etapaPin === 'codigo' ? fecharModalLiberacao : () => { setEtapaPin('codigo'); setPinLiberacao(''); setErroPin('') }}
                disabled={validandoPin}
              >
                <iconify-icon icon="tabler:arrow-left" />
                Voltar
              </button>
              <button
                type="button"
                className="btn-fenix btn-orange btn-modal"
                onClick={etapaPin === 'codigo' ? handleConfirmarCodigo : handleLiberarConta}
                disabled={(etapaPin === 'codigo' ? !codigoOp : !pinLiberacao) || validandoPin}
              >
                <iconify-icon icon="tabler:shield-check" />
                {validandoPin ? 'Validando…' : 'Confirmar'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Overlay: Divergência no peso total ── */}
      {modalPesoTotal && (
        <div className="instrucao-overlay instrucao-overlay--alerta">
          <div className="instrucao-painel">

            {!modoPinPesoTotal ? (
              /* ── Tela principal: aviso ── */
              <>
                <div className="instrucao-icone instrucao-icone--alerta">
                  <IconBalanca size={40} />
                </div>

                <h2 className="instrucao-titulo">Algo não confere</h2>

                <p className="instrucao-sub">
                  Algum produto pode estar faltando ou a mais.<br />
                  Confira a lista e tente novamente.
                </p>

                <div className="autorizacao-btns" style={{ width: '100%' }}>
                  <button
                    type="button"
                    className="btn-fenix btn-red btn-modal"
                    onClick={fecharModalPesoTotal}
                  >
                    <iconify-icon icon="tabler:arrow-left" />
                    Voltar e verificar
                  </button>
                  <button
                    type="button"
                    className="btn-fenix btn-orange btn-modal"
                    onClick={() => { setPinLiberacao(''); setErroPin(''); setModoPinPesoTotal(true) }}
                  >
                    <iconify-icon icon="tabler:shield-check" />
                    Liberar com gerente
                  </button>
                </div>
              </>
            ) : (
              /* ── Tela de autenticação do gerente (dois passos) ── */
              <>
                <div className="instrucao-icone instrucao-icone--liberacao">
                  <iconify-icon icon="tabler:shield-check" />
                </div>

                <h2 className="instrucao-titulo">Confirmação do gerente</h2>
                <p className="instrucao-sub">
                  {etapaPin === 'codigo' ? 'Digite o código do operador.' : 'Digite a senha do operador.'}
                </p>

                <button type="button" ref={pinCampoRef} className="autorizacao-campo autorizacao-campo--ativo" disabled={validandoPin}>
                  <span
                    key={etapaPin}
                    className={`autorizacao-campo-valor${(etapaPin === 'codigo' ? codigoOp : pinLiberacao).length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
                  >
                    {etapaPin === 'codigo'
                      ? (codigoOp.length > 0 ? codigoOp : 'Código')
                      : (pinLiberacao.length > 0 ? '●'.repeat(pinLiberacao.length) : 'Senha')}
                  </span>
                </button>

                <div className="liberacao-numpad">
                  <div className="numpad-grid">
                    {PIN_KEYS.map((key, i) => (
                      key === '' ? <div key={i} /> :
                      <button
                        key={key + i}
                        type="button"
                        className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                        onClick={() => {
                          if (etapaPin === 'codigo') {
                            if (key === '⌫') setCodigoOp(p => p.slice(0, -1))
                            else if (codigoOp.length < 10) setCodigoOp(p => p + key)
                          } else {
                            if (key === '⌫') setPinLiberacao(p => p.slice(0, -1))
                            else if (pinLiberacao.length < 10) setPinLiberacao(p => p + key)
                          }
                        }}
                        disabled={validandoPin}
                      >
                        {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
                      </button>
                    ))}
                  </div>
                </div>

                {erroPin && (
                  <div className="autorizacao-erro">
                    <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
                    {erroPin}
                  </div>
                )}

                <div className="autorizacao-btns">
                  <button
                    type="button"
                    className="btn-fenix btn-dark btn-modal"
                    onClick={etapaPin === 'codigo'
                      ? () => { setModoPinPesoTotal(false); resetarPin() }
                      : () => { setEtapaPin('codigo'); setPinLiberacao(''); setErroPin('') }}
                    disabled={validandoPin}
                  >
                    <iconify-icon icon="tabler:arrow-left" />
                    {etapaPin === 'codigo' ? 'Voltar' : 'Voltar'}
                  </button>
                  <button
                    type="button"
                    className="btn-fenix btn-orange btn-modal"
                    onClick={etapaPin === 'codigo' ? handleConfirmarCodigo : handleLiberarPesoTotal}
                    disabled={(etapaPin === 'codigo' ? !codigoOp : !pinLiberacao) || validandoPin}
                  >
                    <iconify-icon icon="tabler:shield-check" />
                    {validandoPin ? 'Validando…' : 'Confirmar'}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* ── Modal: Definir quantidade ── */}
      {modalQuantidade && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setModalQuantidade(false); setDigQuantidade('') } }}>
          <div className="modal-card modal-quantidade-card" onClick={e => e.stopPropagation()}>

            <div className="modal-quantidade-icon">
              <iconify-icon icon="tabler:packages" />
            </div>

            <h2 className="modal-titulo">Quantos itens quer passar?</h2>

            <div className="quantidade-display">
              {digQuantidade || <span style={{ opacity: 0.3 }}>0</span>}
            </div>

            <div className="liberacao-numpad">
              <div className="numpad-grid">
                {['7','8','9','4','5','6','1','2','3','','0','⌫'].map((key, i) => (
                  key === '' ? <div key={i} /> :
                  <button
                    key={key + i}
                    type="button"
                    className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                    onClick={() => {
                      if (key === '⌫') setDigQuantidade(d => d.slice(0, -1))
                      else if (digQuantidade.length < 3) setDigQuantidade(d => d + key)
                    }}
                  >
                    {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
                  </button>
                ))}
              </div>
            </div>

            <div className="autorizacao-btns">
              <button
                type="button"
                className="btn-fenix btn-dark btn-modal"
                onClick={() => { setModalQuantidade(false); setDigQuantidade(''); focarInput(80) }}
              >
                <iconify-icon icon="tabler:x" />
                Fechar
              </button>
              <button
                type="button"
                className="btn-fenix btn-blue btn-modal"
                disabled={!digQuantidade || parseInt(digQuantidade) < 1}
                onClick={() => {
                  const q = Math.max(1, parseInt(digQuantidade) || 1)
                  setQuantidadePendente(q)
                  setModalQuantidade(false)
                  setDigQuantidade('')
                  if (q > 1) {
                    setModoPassarProduto(true)
                  } else {
                    focarInput(80)
                  }
                }}
              >
                <iconify-icon icon="tabler:check" />
                Confirmar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Modal: Digitação manual de código ── */}
      {modalDigitarCodigo && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setModalDigitarCodigo(false); focarInput(80) } }}>
          <div className="modal-card digitar-codigo-card" onClick={e => e.stopPropagation()}>
            <button className="digitar-codigo-btn-voltar" onClick={() => { setModalDigitarCodigo(false); focarInput(80) }}>
              <iconify-icon icon="tabler:arrow-left" />
            </button>

            <p className="digitar-codigo-label label-mono">
              <iconify-icon icon="tabler:barcode" />
              Digite o código do produto
            </p>

            <div className="digitar-codigo-display">
              {codigoManual || <span className="digitar-codigo-placeholder">0</span>}
            </div>

            <div className="liberacao-numpad">
              <div className="numpad-grid">
                {['7','8','9','4','5','6','1','2','3','','0','⌫'].map((key, i) => (
                  key === '' ? <div key={i} /> :
                  <button
                    key={key + i}
                    type="button"
                    className={`numpad-key${key === '⌫' ? ' numpad-key--del' : ''}`}
                    onClick={() => {
                      if (key === '⌫') setCodigoManual(c => c.slice(0, -1))
                      else setCodigoManual(c => c + key)
                    }}
                  >
                    {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
                  </button>
                ))}
              </div>
            </div>

            <div className="digitar-codigo-btns">
              <button
                type="button"
                className="btn-fenix btn-dark"
                style={{ height: '56px', fontSize: '1rem', flex: 1 }}
                onClick={() => setCodigoManual('')}
              >
                <iconify-icon icon="tabler:eraser" />
                Limpar
              </button>
              <button
                type="button"
                className="btn-fenix btn-blue"
                style={{ height: '56px', fontSize: '1rem', flex: 2 }}
                disabled={!codigoManual}
                onClick={() => {
                  const cod = codigoManual
                  setModalDigitarCodigo(false)
                  setCodigoManual('')
                  handleCodigoSubmit(null, cod)
                }}
              >
                <iconify-icon icon="tabler:check" />
                Confirmar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Modal: Busca manual de produto ── */}
      {modalBusca && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalBusca(false) }}>
          <div className="modal-card modal-busca-card" onClick={e => e.stopPropagation()}>

            <div className="modal-busca-header">
              <div className="modal-busca-icon">
                <iconify-icon icon="tabler:barcode" />
              </div>
              <h2 className="modal-titulo" style={{ textAlign: 'left', fontSize: '1.25rem' }}>Passe o produto no leitor</h2>
            </div>

            <form onSubmit={handleBuscaSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input
                ref={modalInputRef}
                type="text"
                value={codigoBusca}
                onChange={e => { setCodigoBusca(e.target.value); setProdutoEncontrado(null); setErroBusca('') }}
                placeholder="Aguardando leitura…"
                className="barcode-input"
                autoComplete="off"
                disabled={buscando}
              />
              <button
                type="submit"
                className="btn-fenix btn-dark btn-modal--sm"
                disabled={buscando || !codigoBusca}
              >
                <iconify-icon icon="tabler:search" style={{ fontSize: '1rem' }} />
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </form>

            {erroBusca && (
              <div className="operacao-erro" style={{ width: '100%' }}>
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
                {erroBusca}
              </div>
            )}

            {produtoEncontrado && (
              <div className="modal-produto-encontrado">
                <span className="modal-produto-label label-mono">Produto encontrado</span>
                <span className="modal-produto-nome">{produtoEncontrado.descricao}</span>
                <span className="modal-produto-codigo label-mono">{produtoEncontrado.codigo}</span>
                <span className="modal-produto-preco">R$ {produtoEncontrado.valor_unitario.toFixed(2)}</span>
              </div>
            )}

            <div className="modal-acoes">
              <button type="button" className="btn-fenix btn-dark btn-modal" onClick={() => setModalBusca(false)}>
                <iconify-icon icon="tabler:arrow-left" />
                Voltar
              </button>
              {produtoEncontrado && (
                <button type="button" className="btn-fenix btn-green btn-modal" onClick={handleAdicionarProduto}>
                  <iconify-icon icon="tabler:circle-plus" />
                  Adicionar à compra
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── Overlay: Verificando / Aprendendo peso na balança ── */}
      {(verificandoPeso || aprendendoPeso || pesandoEtiqueta) && (
        <div className="instrucao-overlay instrucao-overlay--verificar">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--verificar">
              <IconBalanca size={40} />
            </div>

            {/* Produto + preço — o usuário decide antes de colocar no balcão */}
            {produtoNaBalanca && (
              <div className="instrucao-produto-info">
                <span className="instrucao-produto-nome">{produtoNaBalanca.descricao}</span>
                <span className="instrucao-produto-preco">
                  {(produtoNaBalanca.valor_unitario ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  <span className="instrucao-produto-unidade">
                    {produtoNaBalanca.unidade === 'KG' ? '/kg' : '/un'}
                  </span>
                </span>
              </div>
            )}

            <h2 className="instrucao-titulo">
              {quantidadePendente > 1
                ? `Coloque os ${quantidadePendente} itens no balcão`
                : 'Coloque o produto no balcão'}
            </h2>

            <div className="instrucao-countdown">
              <span className="instrucao-countdown-num instrucao-countdown-num--verificar">
                {contagemBalanca}
              </span>
              <span className="instrucao-countdown-s">s</span>
            </div>

            <div className="instrucao-progresso-track">
              <div
                className="instrucao-progresso-bar instrucao-progresso-bar--verificar"
                style={{ width: `${(contagemBalanca / calcularParamsBalanca(quantidadePendente).esperaS) * 100}%` }}
              />
            </div>

            <button
              type="button"
              className="btn-fenix btn-dark instrucao-btn-voltar"
              onClick={handleVoltarPesagem}
            >
              <iconify-icon icon="tabler:arrow-left" />
              Voltar
            </button>

          </div>
        </div>
      )}

      {/* ── Overlay: Verificando peso total antes do pagamento ── */}
      {verificandoTotal && (
        <div className="instrucao-overlay instrucao-overlay--total">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--total">
              <IconBalanca size={40} />
            </div>

            <h2 className="instrucao-titulo">Fechando sua conta</h2>

            <p className="instrucao-sub" style={{whiteSpace: 'nowrap'}}>
              Aguarde um momento
            </p>

            <div className="instrucao-spinner">
              <iconify-icon icon="tabler:loader-2" class="spin" style={{ fontSize: '1.5rem', color: 'var(--fenix-blue)' }} />
              Aguardando…
            </div>

          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="operacao-header reveal d-1 active">
        <button
          className="btn-voltar"
          onClick={() => navigate('/inicio')}
          disabled={itens.length > 0}
          title={itens.length > 0 ? 'Cancele a conta antes de voltar' : undefined}
        >
          <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1rem' }} />
          Voltar
        </button>

        <div className="operacao-header-divider" />

        <div className="operacao-logo-mark">
          <img src="/caixalivre-icon.svg" alt="CaixaLivre" className="cl-logo-svg" />
        </div>
        <span className="operacao-logo-text">Caixa<span>Livre</span></span>
      </header>

      {/* ── Main ── */}
      <main className="operacao-main">

        {/* Coluna esquerda: lista de produtos */}
        <div className="lista-col reveal-blur d-2 active">
          <div className="lista-header-row label-mono">
            <span>Nº</span>
            <span>Produto</span>
            <span style={{ textAlign: 'right' }}>Qtd</span>
            <span style={{ textAlign: 'right' }}>VL Un.</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>

          <div className="lista-itens" ref={listaItensRef}>
            {itens.length === 0 ? (
              <div className="lista-vazia">
                <div className="lista-vazia-icon-wrap">
                  <div className="lista-vazia-icon-circle">
                    <iconify-icon icon="tabler:barcode" />
                    <div className="lista-vazia-scan-beam" />
                  </div>
                </div>
                <span className="lista-vazia-txt">Passe o produto no leitor</span>
                <span className="lista-vazia-sub">Código de barras ou busca manual</span>
              </div>
            ) : (
              itens.map((item, index) => (
                <div
                  key={item.id}
                  className={[
                    'item-linha',
                    item.cancelado                                              ? 'item-cancelado'              : '',
                    !item.cancelado && selecionadosCancelamento.has(item.id)   ? 'item-selecionado-cancelamento': '',
                    itemSelecionado === item.id                                 ? 'item-selecionado'             : '',
                    modoExclusao && !item.cancelado && !selecionadosCancelamento.has(item.id) ? 'item-modo-exclusao' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ animationDelay: `${index * 0.04}s` }}
                  onClick={() => handleItemClick(item)}
                >
                  <span className="item-ordinal">{item.ordinal ?? index + 1}</span>
                  <span className="item-nome">{item.descricao}</span>
                  <span className="item-qtd">{item.quantidade} {item.unidade}</span>
                  <span className="item-preco">R$ {item.valor_unitario.toFixed(2)}</span>
                  <span className="item-total">R$ {(item.valor_unitario * item.quantidade).toFixed(2)}</span>
                </div>
              ))
            )}
          </div>

          {/* Barra flutuante de cancelamento em lote */}
          {modoExclusao && selecionadosCancelamento.size > 0 && (
            <div className="batch-cancel-bar">
              <div className="batch-cancel-info">
                <iconify-icon icon="tabler:checkbox" style={{ fontSize: '1.2rem' }} />
                <span>
                  {selecionadosCancelamento.size} {selecionadosCancelamento.size === 1 ? 'produto selecionado' : 'produtos selecionados'}
                </span>
              </div>
              <button className="btn-fenix btn-red batch-cancel-btn" onClick={handleAbrirConfirmarBatch}>
                <iconify-icon icon="tabler:trash" />
                Cancelar {selecionadosCancelamento.size === 1 ? 'produto' : 'produtos'}
              </button>
            </div>
          )}

          <div className="subtotal-bar">
            <div className="subtotal-info">
              <span className="subtotal-label">Total da compra</span>
              {itens.length > 0 && (() => {
                const ativos = itens.filter(i => !i.cancelado).length
                return (
                  <span className="subtotal-count">
                    {ativos} {ativos === 1 ? 'produto' : 'produtos'}
                    {ativos < itens.length && (
                      <span className="subtotal-cancelados"> · {itens.length - ativos} cancelado{itens.length - ativos > 1 ? 's' : ''}</span>
                    )}
                  </span>
                )
              })()}
            </div>
            <span className="subtotal-valor">R$ {total.toFixed(2)}</span>
          </div>
        </div>

        {/* Coluna direita: controles */}
        <aside className="controles-col reveal-blur d-3 active">

          {/* ── Zona de produto: leitor + busca + quantidade ── */}
          <form onSubmit={handleCodigoSubmit} className={`barcode-card${carregando ? ' barcode-card--carregando' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="barcode-label label-mono">
                <iconify-icon icon="tabler:barcode" style={{ fontSize: '1rem', marginRight: '0.3rem' }} />
                Leitor
              </span>
              {carregando ? (
                <span className={`barcode-terminal-status barcode-terminal-status--busy`}>
                  <iconify-icon icon="tabler:loader-2" class="spin" style={{ fontSize: '1rem' }} />
                  Buscando…
                </span>
              ) : (
                <span className="barcode-terminal-status">
                  <span className="pulse-dot" style={{ width: '6px', height: '6px' }} />
                  Pronto
                </span>
              )}
            </div>

            <input
              ref={inputRef}
              type="text"
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              placeholder="Aguardando leitura…"
              className="barcode-input"
              autoComplete="off"
              disabled={modoExclusao || carregando || verificandoPeso || aprendendoPeso || pesandoEtiqueta || modoPassarProduto}
            />

            {/* Divisor visual entre o leitor e os atalhos de produto */}
            <div className="barcode-card-divisor" />

            <div className="barcode-card-acoes">
              <button
                type="button"
                className="btn-fenix btn-dark btn-barcode-action"
                onClick={() => setModalBusca(true)}
                disabled={modoExclusao}
              >
                <iconify-icon icon="tabler:search" style={{ fontSize: '1rem' }} />
                Consultar
              </button>

              <button
                type="button"
                className="btn-fenix btn-dark btn-barcode-action"
                onClick={() => { setCodigoManual(''); setModalDigitarCodigo(true) }}
                disabled={modoExclusao || carregando}
              >
                <iconify-icon icon="tabler:keyboard" style={{ fontSize: '1rem' }} />
                Digitar
              </button>

              <button
                type="button"
                className={`btn-fenix btn-barcode-action${quantidadePendente > 1 ? ' btn-blue' : ' btn-dark'}`}
                onClick={() => {
                  setDigQuantidade(quantidadePendente > 1 ? String(quantidadePendente) : '')
                  setModalQuantidade(true)
                }}
                disabled={modoExclusao}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                  <rect x="3" y="10" width="18" height="4" rx="2"/>
                  <rect x="10" y="3" width="4" height="18" rx="2"/>
                </svg>
                {quantidadePendente > 1 ? `${quantidadePendente}×` : 'Quantidade'}
              </button>
            </div>
          </form>

          {/* ── Pesar produto ── */}
          <button
            type="button"
            className="btn-fenix btn-dark btn-pesar-produto"
            onClick={async () => {
              setErroBalanca('')
              setVerificandoBalanca(true)
              try {
                const cfg = await buscarConfiguracaoBalancaTotem()
                if (!cfg.habilitada || !cfg.pronto) {
                  setErroBalanca('Balança desligada. Chame um atendente.')
                  return
                }
                setModalPesagem(true)
              } catch {
                setErroBalanca('Balança desligada. Chame um atendente.')
              } finally {
                setVerificandoBalanca(false)
              }
            }}
            disabled={modoExclusao || carregando || verificandoBalanca}
          >
            {verificandoBalanca
              ? <iconify-icon icon="tabler:loader-2" class="spin" style={{ fontSize: '1.1rem' }} />
              : <IconBalancaTotem size={40} color="#ffffff" />
            }
            Pesar produto / Balança
          </button>

          {erroBalanca && (
            <div className="operacao-erro reveal active">
              <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
              {erroBalanca}
            </div>
          )}

          {/* Aviso modo exclusão */}
          {modoExclusao && (
            <div className="aviso-exclusao reveal active">
              <iconify-icon icon="tabler:pointer" style={{ fontSize: '1.1rem' }} />
              {selecionadosCancelamento.size === 0
                ? 'Toque nos produtos que deseja cancelar'
                : `${selecionadosCancelamento.size} ${selecionadosCancelamento.size === 1 ? 'produto selecionado' : 'produtos selecionados'}`}
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="operacao-erro reveal active">
              <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
              {erro}
            </div>
          )}

          {/* ── Zona de conta: ações que afetam a comanda inteira ── */}
          <div className="botoes-acao">
            <button
              className="btn-fenix btn-red btn-acao"
              onClick={abrirAutorizacaoCancelamento}
              disabled={itens.length === 0 || modoExclusao}
            >
              <iconify-icon icon="tabler:circle-x" style={{ fontSize: '1.5rem' }} />
              Cancelar conta
            </button>

            <button
              className={`btn-fenix btn-acao${modoExclusao ? ' btn-dark' : ' btn-orange'}`}
              onClick={modoExclusao ? handleSairModoExclusao : handleCancelarItemClick}
              disabled={!modoExclusao && itens.filter(i => !i.cancelado).length === 0}
            >
              <iconify-icon icon={modoExclusao ? 'tabler:x' : 'tabler:trash'} style={{ fontSize: '1.5rem' }} />
              {modoExclusao ? 'Sair da seleção' : 'Cancelar produto'}
            </button>

            <button
              className="btn-fenix btn-green btn-acao--primary"
              onClick={handlePagamento}
              disabled={modoExclusao || itens.filter(i => !i.cancelado).length === 0 || verificandoTotal}
              aria-busy={verificandoTotal}
            >
              {verificandoTotal
                ? <iconify-icon icon="tabler:loader-2" class="spin" />
                : <iconify-icon icon="tabler:credit-card" />
              }
              {verificandoTotal ? 'Verificando…' : 'Pagamento'}
            </button>
          </div>

        </aside>
      </main>

      {/* ── Modal: Confirmação de cancelamento em lote ── */}
      {modalConfirmarBatch && (() => {
        const itemsBatch = itens.filter(i => selecionadosCancelamento.has(i.id))
        const totalBatch = itemsBatch.reduce((s, i) => s + i.valor_unitario * i.quantidade, 0)
        return (
          <div className="cancelar-item-overlay">
            <div className="cancelar-item-card cancelar-item-card--batch">
              <div className="cancelar-item-icon-wrap">
                <iconify-icon icon="tabler:trash" />
              </div>
              <h2 className="cancelar-item-titulo">
                Cancelar {itemsBatch.length} {itemsBatch.length === 1 ? 'produto' : 'produtos'}?
              </h2>
              <div className="cancelar-batch-lista">
                {itemsBatch.map(item => (
                  <div key={item.id} className="cancelar-batch-item">
                    <span className="cancelar-batch-ordinal">{item.ordinal}.</span>
                    <span className="cancelar-batch-nome">{item.descricao}</span>
                    <span className="cancelar-batch-valor">
                      R$ {(item.valor_unitario * item.quantidade).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="cancelar-batch-total">
                <span className="cancelar-batch-total-label">Total a cancelar</span>
                <span className="cancelar-batch-total-valor">R$ {totalBatch.toFixed(2).replace('.', ',')}</span>
              </div>
              <div className="cancelar-item-btns">
                <button
                  className="btn-voltar"
                  onClick={() => setModalConfirmarBatch(false)}
                >
                  <iconify-icon icon="tabler:arrow-left" />
                  Voltar
                </button>
                <button
                  className="btn-fenix btn-red cancelar-item-confirmar"
                  onClick={handleConfirmarBatch}
                >
                  <iconify-icon icon="tabler:trash" />
                  Sim, cancelar
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Modal: Autorização do gerente para cancelamento em lote ── */}
      {modalAuthBatch && (
        <div className="instrucao-overlay instrucao-overlay--liberacao">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--liberacao">
              <iconify-icon icon="tabler:shield-check" />
            </div>

            <h2 className="instrucao-titulo">Autorizar cancelamento</h2>
            <p className="instrucao-sub">
              {etapaPin === 'codigo' ? 'Digite o código do operador.' : 'Digite a senha do operador.'}
            </p>

            <button type="button" ref={pinCampoRef} className="autorizacao-campo autorizacao-campo--ativo" disabled={validandoPin}>
              <span
                key={etapaPin}
                className={`autorizacao-campo-valor${(etapaPin === 'codigo' ? codigoOp : pinLiberacao).length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
              >
                {etapaPin === 'codigo'
                  ? (codigoOp.length > 0 ? codigoOp : 'Código')
                  : (pinLiberacao.length > 0 ? '●'.repeat(pinLiberacao.length) : 'Senha')}
              </span>
            </button>

            <div className="liberacao-numpad">
              <div className="numpad-grid">
                {PIN_KEYS.map((key, i) => (
                  key === '' ? <div key={i} /> :
                  <button
                    key={key + i}
                    type="button"
                    className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                    onClick={() => {
                      if (etapaPin === 'codigo') {
                        if (key === '⌫') setCodigoOp(p => p.slice(0, -1))
                        else if (codigoOp.length < 10) setCodigoOp(p => p + key)
                      } else {
                        if (key === '⌫') setPinLiberacao(p => p.slice(0, -1))
                        else if (pinLiberacao.length < 10) setPinLiberacao(p => p + key)
                      }
                    }}
                    disabled={validandoPin}
                  >
                    {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
                  </button>
                ))}
              </div>
            </div>

            {erroPin && (
              <div className="autorizacao-erro">
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
                {erroPin}
              </div>
            )}

            <div className="autorizacao-btns">
              <button
                type="button"
                className="btn-fenix btn-dark btn-modal"
                onClick={etapaPin === 'codigo'
                  ? () => { setModalAuthBatch(false); resetarPin() }
                  : () => { setEtapaPin('codigo'); setPinLiberacao(''); setErroPin('') }}
                disabled={validandoPin}
              >
                <iconify-icon icon="tabler:arrow-left" />
                Voltar
              </button>
              <button
                type="button"
                className="btn-fenix btn-orange btn-modal"
                onClick={etapaPin === 'codigo' ? handleConfirmarCodigo : handleLiberarCancelamentoItens}
                disabled={(etapaPin === 'codigo' ? !codigoOp : !pinLiberacao) || validandoPin}
              >
                <iconify-icon icon="tabler:shield-check" />
                {validandoPin ? 'Validando…' : 'Confirmar'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Modal: múltiplas unidades detectadas pela balança ── */}
      {modalQtdDetectada && produtoQtdDetect && (
        <div className="modal-overlay">
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-icon-wrap" style={{ background: 'rgba(0,139,195,0.10)', color: 'var(--fenix-blue)' }}>
              <iconify-icon icon="tabler:packages" style={{ fontSize: '2.2rem' }} />
            </div>
            <h2 className="modal-titulo">
              {qtdDetectada} unidades no balcão
            </h2>
            <p className="modal-desc">
              Identificamos <strong>{qtdDetectada}×</strong> o produto<br />
              <strong>{produtoQtdDetect.descricao}</strong>. Vai levar os {qtdDetectada}?
            </p>
            <div className="modal-acoes" style={{ flexDirection: 'row', gap: '0.75rem' }}>
              <button
                className="btn-fenix btn-dark"
                style={{ height: '60px', fontSize: '1rem', flex: 1 }}
                onClick={handleCancelarQtdDetectada}
              >
                <iconify-icon icon="tabler:arrow-left" />
                Não, voltar
              </button>
              <button
                className="btn-fenix btn-blue"
                style={{ height: '60px', fontSize: '1rem', flex: 1 }}
                onClick={handleConfirmarQtdDetectada}
              >
                <iconify-icon icon="tabler:check" />
                Sim, são {qtdDetectada}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Overlay: aguardando remover itens extras ── */}
      {modoRemoverItens && (
        <div className="instrucao-overlay instrucao-overlay--verificar">
          <div className="instrucao-painel">
            <iconify-icon icon="tabler:hand-stop" style={{ fontSize: '3rem', color: 'var(--fenix-blue)' }} />
            <h2 style={{ color: '#fff', fontFamily: 'Montserrat', fontWeight: 800 }}>
              Retire os itens extras
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
              Deixe apenas 1 unidade na balança e aguarde
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'rgba(255,255,255,0.6)' }}>
              <iconify-icon icon="tabler:loader-2" class="spin" style={{ fontSize: '1.4rem' }} />
              <span className="label-mono">Aguardando balança…</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Overlay de pesagem ── */}
      {modalPesagem && (
        <PesagemPage
          onFechar={() => { setModalPesagem(false); focarInput(80) }}
          onRegistrar={(item, pesoKg) => {
            registrarProduto({ ...item, quantidade: pesoKg })
            setModalPesagem(false)
            focarInput(80)
          }}
        />
      )}
    </div>
  )
}
