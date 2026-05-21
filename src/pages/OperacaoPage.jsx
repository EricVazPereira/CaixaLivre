import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import {
  buscarProduto, gravarItens,
  medirPesoBalanca, salvarFormatoPro, lerPesoEstavelBalanca,
  buscarConfiguracaoBalanca, reconectarBalanca,
  cancelarConta as cancelarContaAPI, verificarPermissao,
} from '../services/api'
import { normalizarCodigo } from '../utils/barcode'
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

const TOLERANCIA_PESO = 0.15        // 15%
const ESPERA_UNITARIO_S  = 15       // segundos de espera para qty = 1
const ESPERA_MULTIPLO_S  = 60       // segundos de espera para qty > 1
const ESTAB_UNITARIO_MS  = 1000     // estabilidade para qty = 1
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

  // Modal de busca manual
  const [modalBusca, setModalBusca]               = useState(false)
  const [codigoBusca, setCodigoBusca]             = useState('')
  const [produtoEncontrado, setProdutoEncontrado] = useState(null)
  const [erroBusca, setErroBusca]                 = useState('')
  const [buscando, setBuscando]                   = useState(false)

  // Modal de autorização para cancelar conta
  const [modalAutorizarCancelamento, setModalAutorizarCancelamento] = useState(false)

  // Modal de confirmação de cancelamento de conta
  const [modalCancelarConta, setModalCancelarConta] = useState(false)
  const [cancelando, setCancelando]               = useState(false)
  const [erroCancelar, setErroCancelar]           = useState('')

  const [balancaHabilitada, setBalancaHabilitada] = useState(true)

  const inputRef      = useRef(null)
  const inputPassarRef = useRef(null)
  const modalInputRef = useRef(null)
  const erpSessionId  = useRef('')

  const { erpBarcode, setErpBarcode, nextItemContador } = useCaixaStore()

  const {
    itens, itemSelecionado,
    adicionarItem, selecionarItem,
    cancelarItemSelecionado, cancelarConta: cancelarContaStore, subtotal,
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
  }, [])

  // Focus overlay de quantidade quando abrir
  useEffect(() => {
    if (modoPassarProduto) setTimeout(() => inputPassarRef.current?.focus(), 80)
  }, [modoPassarProduto])

  // Focus modal de busca quando abrir
  useEffect(() => {
    if (modalBusca) setTimeout(() => modalInputRef.current?.focus(), 80)
    else { setCodigoBusca(''); setProdutoEncontrado(null); setErroBusca('') }
  }, [modalBusca])

  useEffect(() => {
    if (!erpBarcode) erpSessionId.current = ''
  }, [erpBarcode])

  // Auto-retorno ao início após 1 min de inatividade com carrinho vazio
  useEffect(() => {
    if (itens.length > 0) return
    const t = setTimeout(() => navigate('/inicio'), 60_000)
    return () => clearTimeout(t)
  }, [itens.length, navigate])

  useEffect(() => {
    function handleDocClick(e) {
      if (!e.target.closest('button, input, .item-linha')) focarInput()
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [focarInput])


  // ── Registra produto no carrinho e no ERP ─────────────────────────────────
  function registrarProduto(produto) {
    const qtd = produto.quantidade || 1

    if (!produto.codigo) {
      console.error('[registrarProduto] Produto sem código:', JSON.stringify(produto))
      setErro('Produto sem código. Verifique o cadastro no ERP.')
      return
    }

    const contador = nextItemContador()
    adicionarItem({ ...produto, contador }, qtd)

    gravarItens({
      id:      erpSessionId.current,   // vazio no primeiro item, barcode nos seguintes
      consumo: [{ produto_codigo: produto.codigo, quantidade: qtd, vl_unitario: produto.valor_unitario, obs: '' }],
    }).then(res => {
      // ERP retorna o barcode (NRGERADOR) que identifica a comanda — guardar em memória
      const erp = res?.erp
      let barcode = null
      if (Array.isArray(erp) && erp.length > 0) {
        barcode = erp[0].barcode ?? erp[0].NRGERADOR ?? erp[0].nrgerador ?? null
      } else if (erp && typeof erp === 'object') {
        barcode = erp.barcode ?? erp.NRGERADOR ?? erp.nrgerador ?? null
      }

      if (barcode) {
        // Guarda em memória — usado como id em todos os GravaItens seguintes
        erpSessionId.current = String(barcode)
        setErpBarcode(String(barcode))
      } else {
        console.warn('[GravaItens] Barcode não encontrado na resposta do ERP:', JSON.stringify(erp))
      }
    }).catch(err => {
      console.error('[GravaItens] Falha na sincronização com ERP:', err.message)
      setErro(mensagemErro(err))
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
    }
  }

  // ── Verifica total acumulado ───────────────────────────────────────────────
  function checarTotalAcumulado(pesoNaBalanca, totalEsperado) {
    if (!pesoNaBalanca || !totalEsperado || totalEsperado <= 0) return
    const diff = Math.abs(pesoNaBalanca - totalEsperado) / totalEsperado
    console.log(`[balanca/total] balança=${pesoNaBalanca}g | esperado=${totalEsperado}g | diff=${(diff * 100).toFixed(1)}%`)
    if (diff > TOLERANCIA_PESO) setModalPesoTotal(true)
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
  async function handleCodigoSubmit(e) {
    e.preventDefault()

    // Verifica etiqueta de balança antes de normalizar
    const etiqueta = parseEtiquetaBalanca(codigo)

    if (!etiqueta) {
      const cod = normalizarCodigo(codigo)
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
        const cod = normalizarCodigo(codigo)
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
            const { esperaS, estabMs } = calcularParamsBalanca(1)
            const resultado = await medirComContagem(esperaS, estabMs, setPesandoEtiqueta)

            if (!resultado.ok) {
              if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
              return
            }

            const pesoMedido    = resultado.peso_gramas
            const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) + pesoMedido
            registrarProduto({ ...produto, quantidade: 1, valor_unitario: etiquetaComCodigo.preco, peso_gramas: pesoMedido })
            checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)
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
        const resultado = await medirComContagem(esperaS, estabMs, setVerificandoPeso)

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
          const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) + deltaEsperado
          registrarProduto({ ...produto, quantidade: qtd })
          checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)
        } else {
          setProdutoPendente({ ...produto, quantidade: qtd })
          setModalLiberacao(true)
        }
        return
      }

      // ── Produto SEM peso cadastrado: aprende pela balança ─────────────────
      if (balancaHabilitada) {
        setCarregando(false)
        const resultado = await medirComContagem(esperaS, estabMs, setAprendendoPeso)

        if (!resultado.ok) {
          setQuantidadePendente(1)
          if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
          return
        }

        const pesoUnitario  = Math.round(resultado.peso_gramas / qtd)
        const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0) + resultado.peso_gramas
        setQuantidadePendente(1)
        registrarProduto({ ...produto, quantidade: qtd, peso_gramas: pesoUnitario })
        salvarFormatoPro(produto.codigo, pesoUnitario)
          .then(ok => console.log(`[balanca] ${ok ? '✅' : '⚠️'} FORMATO_PRO ${produto.codigo} → ${pesoUnitario}g (${qtd}×)`))
        checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)
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

    if (!erpBarcode) {
      setErro('Falha na sincronização com o sistema. Chame um atendente.')
      return
    }

    if (balancaHabilitada) {
      const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0)
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

    navigate('/pagamento')
  }

  // ── Abre modal de autorização para cancelar conta ────────────────────────
  function abrirAutorizacaoCancelamento() {
    resetarPin()
    setModalAutorizarCancelamento(true)
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
        setErroPin(permissao.mensagem || 'Sem permissão para esta operação.')
        setPinLiberacao('')
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
      const permissao = await verificarPermissao({ funcao: 'CANCEL_CONTA_CX_FUN', codigo: codigoOp, senha: pinLiberacao })
      if (permissao.ok) {
        registrarProduto(produtoPendente)
        setModalLiberacao(false)
        setProdutoPendente(null)
        resetarPin()
        focarInput(100)
      } else {
        setErroPin(permissao.mensagem || 'Sem permissão para esta operação.')
        setPinLiberacao('')
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  // ── Passo 2b: verifica permissão no ERP e libera pagamento (divergência total) ──
  async function handleLiberarPesoTotal() {
    if (!pinLiberacao) { setErroPin('Digite a senha.'); return }
    setValidandoPin(true)
    setErroPin('')
    try {
      const permissao = await verificarPermissao({ funcao: 'CANCEL_CONTA_CX_FUN', codigo: codigoOp, senha: pinLiberacao })
      if (permissao.ok) {
        setModalPesoTotal(false)
        setModoPinPesoTotal(false)
        resetarPin()
        navigate('/pagamento')
      } else {
        setErroPin(permissao.mensagem || 'Sem permissão para esta operação.')
        setPinLiberacao('')
      }
    } catch {
      setErroPin('Erro ao verificar permissão. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  // ── Gerente ───────────────────────────────────────────────────────────────
  const PIN_KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫']

  // ── Itens ─────────────────────────────────────────────────────────────────
  function handleItemClick(idItem) {
    if (modoExclusao) {
      selecionarItem(idItem)
      setModoExclusao(false)
      navigate('/autorizacao?acao=cancelar-item')
    } else if (itemSelecionado === idItem) {
      selecionarItem(null)
    } else {
      selecionarItem(idItem)
    }
  }

  function handleCancelarItemClick() {
    if (itemSelecionado) {
      navigate('/autorizacao?acao=cancelar-item')
    } else {
      setModoExclusao(true)
      setErro('')
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
    registrarProduto({ ...produtoEncontrado, quantidade: 1 })
    setModalBusca(false)
    focarInput(80)
  }

  const total = subtotal()

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

            <div className="liberacao-pin-display">
              {etapaPin === 'codigo'
                ? (codigoOp.length === 0
                    ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '1rem' }}>código</span>
                    : codigoOp)
                : (pinLiberacao.length === 0
                    ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '1rem' }}>senha</span>
                    : '●'.repeat(pinLiberacao.length))
              }
            </div>

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
                {validandoPin ? 'Validando…' : etapaPin === 'codigo' ? 'Confirmar' : 'Liberar'}
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

            <div className="liberacao-pin-display">
              {etapaPin === 'codigo'
                ? (codigoOp.length === 0
                    ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '1rem' }}>código</span>
                    : codigoOp)
                : (pinLiberacao.length === 0
                    ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '1rem' }}>senha</span>
                    : '●'.repeat(pinLiberacao.length))
              }
            </div>

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
                {validandoPin ? 'Validando…' : etapaPin === 'codigo' ? 'Confirmar' : 'Liberar'}
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
                  <iconify-icon icon="tabler:scale-off" />
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

                <div className="liberacao-pin-display">
                  {etapaPin === 'codigo'
                    ? (codigoOp.length === 0
                        ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '1rem' }}>código</span>
                        : codigoOp)
                    : (pinLiberacao.length === 0
                        ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '1rem' }}>senha</span>
                        : '●'.repeat(pinLiberacao.length))
                  }
                </div>

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
                    {validandoPin ? 'Validando…' : etapaPin === 'codigo' ? 'Confirmar' : 'Liberar'}
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
                onClick={() => { setModalQuantidade(false); setDigQuantidade('') }}
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

      {/* ── Modal: Busca manual de produto ── */}
      {modalBusca && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalBusca(false) }}>
          <div className="modal-card modal-busca-card" onClick={e => e.stopPropagation()}>

            <div className="modal-busca-header">
              <div className="modal-busca-icon">
                <iconify-icon icon="tabler:barcode" />
              </div>
              <h2 className="modal-titulo" style={{ textAlign: 'left', fontSize: '1.25rem' }}>Buscar produto</h2>
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
              <iconify-icon icon="tabler:scale" />
            </div>

            <h2 className="instrucao-titulo">
              {aprendendoPeso && quantidadePendente > 1
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

          </div>
        </div>
      )}

      {/* ── Overlay: Verificando peso total antes do pagamento ── */}
      {verificandoTotal && (
        <div className="instrucao-overlay instrucao-overlay--total">
          <div className="instrucao-painel">

            <div className="instrucao-icone instrucao-icone--total">
              <iconify-icon icon="tabler:scale" />
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
          <iconify-icon icon="tabler:device-tablet" style={{ color: 'white', fontSize: '1.1rem' }} />
        </div>
        <span className="operacao-logo-text">Caixa<span>Livre</span></span>
      </header>

      {/* ── Main ── */}
      <main className="operacao-main">

        {/* Coluna esquerda: lista de produtos */}
        <div className="lista-col reveal-blur d-2 active">
          <div className="lista-header-row label-mono">
            <span>Produto</span>
            <span style={{ textAlign: 'right' }}>Qtd</span>
            <span style={{ textAlign: 'right' }}>VL Un.</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>

          <div className="lista-itens">
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
                    itemSelecionado === item.id ? 'item-selecionado' : '',
                    modoExclusao ? 'item-modo-exclusao' : '',
                  ].join(' ')}
                  style={{ animationDelay: `${index * 0.04}s` }}
                  onClick={() => handleItemClick(item.id)}
                >
                  <span className="item-nome">{item.descricao}</span>
                  <span className="item-qtd">{item.quantidade} {item.unidade}</span>
                  <span className="item-preco">R$ {item.valor_unitario.toFixed(2)}</span>
                  <span className="item-total">R$ {(item.valor_unitario * item.quantidade).toFixed(2)}</span>
                </div>
              ))
            )}
          </div>

          <div className="subtotal-bar">
            <div className="subtotal-info">
              <span className="subtotal-label">Total da compra</span>
              {itens.length > 0 && (
                <span className="subtotal-count">
                  {itens.length} {itens.length === 1 ? 'item' : 'itens'}
                </span>
              )}
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
              disabled={carregando || verificandoPeso || aprendendoPeso || pesandoEtiqueta || modoPassarProduto}
            />

            {/* Divisor visual entre o leitor e os atalhos de produto */}
            <div className="barcode-card-divisor" />

            <div className="barcode-card-acoes">
              <button
                type="button"
                className="btn-fenix btn-dark btn-barcode-action"
                onClick={() => setModalBusca(true)}
              >
                <iconify-icon icon="tabler:search" style={{ fontSize: '1rem' }} />
                Buscar produto
              </button>

              <button
                type="button"
                className={`btn-fenix btn-barcode-action${quantidadePendente > 1 ? ' btn-blue' : ' btn-dark'}`}
                onClick={() => {
                  setDigQuantidade(quantidadePendente > 1 ? String(quantidadePendente) : '')
                  setModalQuantidade(true)
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                  <rect x="3" y="10" width="18" height="4" rx="2"/>
                  <rect x="10" y="3" width="4" height="18" rx="2"/>
                </svg>
                {quantidadePendente > 1 ? `${quantidadePendente}×` : 'Quantidade'}
              </button>
            </div>
          </form>

          {/* Aviso modo exclusão */}
          {modoExclusao && (
            <div className="aviso-exclusao reveal active">
              <iconify-icon icon="tabler:pointer" style={{ fontSize: '1.1rem' }} />
              Toque no item que deseja remover
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
              disabled={itens.length === 0}
            >
              <iconify-icon icon="tabler:circle-x" style={{ fontSize: '1.5rem' }} />
              Cancelar conta
            </button>

            <button
              className={`btn-fenix btn-orange btn-acao${modoExclusao ? ' btn-acao--pulsing' : ''}`}
              onClick={handleCancelarItemClick}
              disabled={itens.length === 0}
              style={modoExclusao ? { boxShadow: '0 0 0 3px rgba(200,113,11,0.4), 0px 7px 20px rgba(200,113,11,0.35)' } : undefined}
            >
              <iconify-icon icon="tabler:trash" style={{ fontSize: '1.5rem' }} />
              {modoExclusao ? 'Selecione um item…' : 'Cancelar item'}
            </button>

            <button
              className="btn-fenix btn-green btn-acao--primary"
              onClick={handlePagamento}
              disabled={itens.length === 0 || verificandoTotal}
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
    </div>
  )
}
