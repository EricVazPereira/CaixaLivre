import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import {
  buscarProduto, gravarItens,
  medirPesoBalanca, salvarFormatoPro, lerPesoEstavelBalanca,
  validarCodigoGeral, buscarConfiguracaoBalanca,
} from '../services/api'
import { normalizarCodigo } from '../utils/barcode'
import './OperacaoPage.css'

export default function OperacaoPage() {
  const navigate = useNavigate()

  const [codigo, setCodigo]                     = useState('')
  const [erro, setErro]                         = useState('')
  const [carregando, setCarregando]             = useState(false)
  const [verificandoPeso, setVerificandoPeso]   = useState(false)
  const [aprendendoPeso, setAprendendoPeso]     = useState(false)
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
  const [pinLiberacao, setPinLiberacao]       = useState('')
  const [erroPin, setErroPin]                 = useState('')
  const [validandoPin, setValidandoPin]       = useState(false)

  // Modal de divergência no total (só aviso + voltar)
  const [modalPesoTotal, setModalPesoTotal] = useState(false)

  // Modal de busca manual
  const [modalBusca, setModalBusca]               = useState(false)
  const [codigoBusca, setCodigoBusca]             = useState('')
  const [produtoEncontrado, setProdutoEncontrado] = useState(null)
  const [erroBusca, setErroBusca]                 = useState('')
  const [buscando, setBuscando]                   = useState(false)

  const [balancaHabilitada, setBalancaHabilitada] = useState(true)

  const inputRef      = useRef(null)
  const inputPassarRef = useRef(null)
  const modalInputRef = useRef(null)
  const erpSessionId  = useRef('')

  const { erpBarcode, setErpBarcode } = useCaixaStore()

  const {
    itens, itemSelecionado,
    adicionarItem, selecionarItem,
    cancelarItemSelecionado, cancelarConta, subtotal,
  } = useCarrinhoStore()

  const focarInput = useCallback((delay = 0) => {
    setTimeout(() => inputRef.current?.focus(), delay)
  }, [])

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus()
    buscarConfiguracaoBalanca().then(cfg => setBalancaHabilitada(cfg.habilitada))
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


  const TOLERANCIA_PESO = 0.15 // 15%

  // ── Registra produto no carrinho e no ERP ─────────────────────────────────
  function registrarProduto(produto) {
    const qtd = produto.quantidade || 1
    adicionarItem(produto, qtd)
    gravarItens({
      id: erpSessionId.current,
      consumo: [{ produto_codigo: produto.codigo, quantidade: qtd, vl_unitario: produto.valor_unitario, obs: '' }],
    }).then(res => {
      const itensERP = Array.isArray(res?.erp) ? res.erp : []
      if (itensERP.length > 0 && itensERP[0].barcode) {
        erpSessionId.current = itensERP[0].barcode
        setErpBarcode(itensERP[0].barcode)
      }
    }).catch(err => console.warn('[GravaItens] Erro:', err.message))
  }

  // ── Countdown visual ──────────────────────────────────────────────────────
  function iniciarContagem(segundos, setterFn) {
    setterFn(segundos)
    const id = setInterval(() => setterFn(c => Math.max(0, c - 1)), 1000)
    return id
  }

  // ── Verifica total acumulado ───────────────────────────────────────────────
  function checarTotalAcumulado(pesoNaBalanca, totalEsperado) {
    if (!pesoNaBalanca || !totalEsperado || totalEsperado <= 0) return
    const diff = Math.abs(pesoNaBalanca - totalEsperado) / totalEsperado
    console.log(`[balanca/total] balança=${pesoNaBalanca}g | esperado=${totalEsperado}g | diff=${(diff * 100).toFixed(1)}%`)
    if (diff > TOLERANCIA_PESO) setModalPesoTotal(true)
  }

  // ── Submit do código de barras ────────────────────────────────────────────
  async function handleCodigoSubmit(e) {
    e.preventDefault()
    const cod = normalizarCodigo(codigo)
    if (!cod || cod === '00000000000000') return

    setModoPassarProduto(false)
    setCarregando(true)
    setErro('')
    setCodigo('')

    try {
      const produto = await buscarProduto(cod)
      if (!produto) { setErro(`Produto não encontrado: ${cod}`); return }

      const qtd      = quantidadePendente
      const ESPERA_S = qtd > 1 ? 60 : 15   // múltiplos itens têm mais tempo
      const ESTAB_MS = qtd > 1 ? 5000 : 1000  // estabilidade: 5s para qty>1, 1s para qty=1

      // ── Produto COM peso cadastrado: aguarda 8s de estabilidade e verifica ─
      if (balancaHabilitada && produto.peso_gramas > 0) {
        setCarregando(false)
        setVerificandoPeso(true)
        const tick         = iniciarContagem(ESPERA_S, setContagemBalanca)
        const deltaEsperado = produto.peso_gramas * qtd

        let resultado
        try {
          resultado = await medirPesoBalanca(ESPERA_S * 1000, ESTAB_MS)
        } catch {
          resultado = { ok: false, sem_comunicacao: true }
        } finally {
          clearInterval(tick)
          setVerificandoPeso(false)
          setContagemBalanca(0)
        }

        if (!resultado.ok) {
          setQuantidadePendente(1)
          if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
          // sem_peso → cliente não colocou → cancela silenciosamente
          return
        }

        // Compara o delta medido com o esperado (±15%)
        const deltaReal = resultado.peso_gramas
        const diff      = Math.abs(deltaReal - deltaEsperado) / deltaEsperado
        console.log(`[balanca] delta medido=${deltaReal}g | esperado=${deltaEsperado}g | diff=${(diff * 100).toFixed(1)}%`)

        if (diff <= TOLERANCIA_PESO) {
          // ✅ Peso correto
          const produtoFinal  = { ...produto, quantidade: qtd }
          const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0)
                              + produto.peso_gramas * qtd
          setQuantidadePendente(1)
          registrarProduto(produtoFinal)
          checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)
        } else {
          // ❌ Divergência → solicita gerente
          setProdutoPendente({ ...produto, quantidade: qtd })
          setModalLiberacao(true)
          setQuantidadePendente(1)
        }
        return
      }

      // ── Produto SEM peso cadastrado ──────────────────────────────────────
      if (balancaHabilitada) {

        // qty > 1: aguarda 8s de estabilidade, aprende peso unitário e só então registra
        if (qtd > 1) {
          setCarregando(false)
          setAprendendoPeso(true)
          const tick = iniciarContagem(ESPERA_S, setContagemBalanca)

          let res2
          try {
            res2 = await medirPesoBalanca(ESPERA_S * 1000, ESTAB_MS)
          } catch {
            res2 = { ok: false, sem_comunicacao: true }
          } finally {
            clearInterval(tick)
            setAprendendoPeso(false)
            setContagemBalanca(0)
          }

          if (!res2.ok) {
            setQuantidadePendente(1)
            if (res2.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
            return
          }

          const pesoUnitario  = Math.round(res2.peso_gramas / qtd)
          const produtoFinal  = { ...produto, quantidade: qtd, peso_gramas: pesoUnitario }
          const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0)
                              + res2.peso_gramas
          setQuantidadePendente(1)
          registrarProduto(produtoFinal)
          salvarFormatoPro(produto.codigo, pesoUnitario)
            .then(ok => console.log(`[balanca] ${ok ? '✅' : '⚠️'} FORMATO_PRO ${produto.codigo} → ${pesoUnitario}g (${qtd}×)`))
          checarTotalAcumulado(res2.peso_absoluto, totalEsperado)
          return
        }

        // qty = 1: aguarda colocação com stability (60 s)
        setCarregando(false)
        setAprendendoPeso(true)
        const tick = iniciarContagem(ESPERA_S, setContagemBalanca)

        let resultado
        try {
          resultado = await medirPesoBalanca(ESPERA_S * 1000, ESTAB_MS)
        } catch {
          resultado = { ok: false, sem_comunicacao: true }
        } finally {
          clearInterval(tick)
          setAprendendoPeso(false)
          setContagemBalanca(0)
        }

        if (!resultado.ok) {
          setQuantidadePendente(1)
          if (resultado.sem_comunicacao) setErro('Falha de comunicação com a balança. Chame um atendente.')
          // sem_peso → cliente não colocou → cancela silenciosamente
          return
        }

        // Aprendeu o peso → grava FORMATO_PRO e adiciona ao carrinho
        const produtoFinal  = { ...produto, quantidade: 1, peso_gramas: resultado.peso_gramas }
        const totalEsperado = itens.reduce((s, it) => s + (it.peso_gramas || 0) * it.quantidade, 0)
                            + resultado.peso_gramas
        setQuantidadePendente(1)
        registrarProduto(produtoFinal)
        salvarFormatoPro(produto.codigo, resultado.peso_gramas)
          .then(ok => console.log(`[balanca] ${ok ? '✅' : '⚠️'} FORMATO_PRO ${produto.codigo} → ${resultado.peso_gramas}g`))
        checarTotalAcumulado(resultado.peso_absoluto, totalEsperado)
        return
      }

      // ── Balança desabilitada ─────────────────────────────────────────────
      setQuantidadePendente(1)
      registrarProduto({ ...produto, quantidade: qtd })

    } catch {
      setErro('Erro de comunicação com o servidor.')
    } finally {
      setCarregando(false)
      setVerificandoPeso(false)
      setAprendendoPeso(false)
      focarInput(50)
    }
  }

  // ── Pagamento ─────────────────────────────────────────────────────────────
  async function handlePagamento() {
    if (itens.length === 0) { setErro('Nenhum produto adicionado.'); return }

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

  // ── Gerente ───────────────────────────────────────────────────────────────
  const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  async function handleLiberarConta() {
    if (!pinLiberacao) { setErroPin('Digite o código do gerente.'); return }
    setValidandoPin(true)
    setErroPin('')
    try {
      const ok = await validarCodigoGeral(pinLiberacao)
      if (ok) {
        registrarProduto(produtoPendente)
        setModalLiberacao(false)
        setProdutoPendente(null)
        setPinLiberacao('')
        focarInput(100)
      } else {
        setErroPin('Código incorreto.')
      }
    } catch {
      setErroPin('Erro ao validar. Tente novamente.')
    } finally {
      setValidandoPin(false)
    }
  }

  function fecharModalLiberacao() {
    setModalLiberacao(false)
    setProdutoPendente(null)
    setPinLiberacao('')
    setErroPin('')
    focarInput(100)
  }

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
    } catch {
      setErroBusca('Erro de comunicação com o servidor.')
    } finally {
      setBuscando(false)
      setCodigoBusca('')
      setTimeout(() => modalInputRef.current?.focus(), 50)
    }
  }

  function handleAdicionarProduto() {
    if (!produtoEncontrado) return
    adicionarItem(produtoEncontrado)
    gravarItens({
      id: erpSessionId.current,
      consumo: [{ produto_codigo: produtoEncontrado.codigo, quantidade: 1, vl_unitario: produtoEncontrado.valor_unitario, obs: '' }],
    }).then(res => {
      const itensERP = Array.isArray(res?.erp) ? res.erp : []
      if (itensERP.length > 0 && itensERP[0].barcode) {
        erpSessionId.current = itensERP[0].barcode
        setErpBarcode(itensERP[0].barcode)
      }
    }).catch(err => console.warn('[GravaItens] Erro:', err.message))
    setModalBusca(false)
    focarInput(80)
  }

  const total = subtotal()

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="operacao-root">

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
              className="btn-fenix btn-dark"
              onClick={() => {
                setModoPassarProduto(false)
                setQuantidadePendente(1)
                setCodigo('')
                focarInput(80)
              }}
              style={{ height: '56px', fontSize: '0.8rem', borderRadius: '14px', width: '100%' }}
            >
              <iconify-icon icon="tabler:x" />
              Cancelar
            </button>

          </div>
        </div>
      )}

      {/* ── Modal: Liberação por gerente ── */}
      {modalLiberacao && (
        <div className="modal-overlay modal-overlay--alerta">
          <div className="modal-card modal-liberacao-card" onClick={e => e.stopPropagation()}>

            <div className="modal-liberacao-icon">
              <iconify-icon icon="tabler:alert-triangle" />
            </div>

            <h2 className="modal-liberacao-titulo">Problema na conferência dos itens</h2>
            <p className="modal-liberacao-desc">Chame um gerente para liberar esta operação.</p>

            <div className="liberacao-pin-display">
              {pinLiberacao.length === 0
                ? <span style={{ opacity: 0.3, letterSpacing: '0.2em', fontSize: '0.85rem' }}>código do gerente</span>
                : '●'.repeat(pinLiberacao.length)
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
                      if (key === '⌫') setPinLiberacao(p => p.slice(0, -1))
                      else if (pinLiberacao.length < 6) setPinLiberacao(p => p + key)
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
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '0.75rem', flexShrink: 0 }} />
                {erroPin}
              </div>
            )}

            <div className="autorizacao-btns" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="btn-fenix btn-dark"
                onClick={fecharModalLiberacao}
                disabled={validandoPin}
                style={{ height: '64px', fontSize: '0.75rem', flex: 1, borderRadius: '14px' }}
              >
                <iconify-icon icon="tabler:arrow-left" />
                Cancelar
              </button>
              <button
                type="button"
                className="btn-fenix btn-orange"
                onClick={handleLiberarConta}
                disabled={!pinLiberacao || validandoPin}
                style={{ height: '64px', fontSize: '0.75rem', flex: 2, borderRadius: '14px' }}
              >
                <iconify-icon icon="tabler:shield-check" />
                {validandoPin ? 'Validando…' : 'Liberar'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Modal: Divergência no peso total ── */}
      {modalPesoTotal && (
        <div className="modal-overlay modal-overlay--alerta">
          <div className="modal-card" style={{ maxWidth: '420px', textAlign: 'center', gap: '1.25rem' }} onClick={e => e.stopPropagation()}>

            <div className="modal-peso-total-icon">
              <iconify-icon icon="tabler:scale-off" />
            </div>

            <h2 className="modal-peso-total-titulo">Atenção! Algo não confere</h2>
            <p className="modal-peso-total-desc">
              Algum produto pode estar faltando ou a mais. Confira a lista e tente novamente.
            </p>

            <button
              type="button"
              className="btn-fenix btn-dark"
              onClick={() => { setModalPesoTotal(false); focarInput(80) }}
              style={{ height: '64px', fontSize: '0.9rem', borderRadius: '16px', width: '100%' }}
            >
              <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1.3rem' }} />
              Voltar e verificar
            </button>

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
                {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => (
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

            <div className="autorizacao-btns" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn-fenix btn-dark"
                onClick={() => { setModalQuantidade(false); setDigQuantidade('') }}
                style={{ height: '64px', fontSize: '0.75rem', flex: 1, borderRadius: '14px' }}
              >
                <iconify-icon icon="tabler:x" />
                Cancelar
              </button>
              <button
                type="button"
                className="btn-fenix btn-blue"
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
                style={{ height: '64px', fontSize: '0.75rem', flex: 2, borderRadius: '14px' }}
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
                className="btn-fenix btn-dark"
                disabled={buscando || !codigoBusca}
                style={{ height: '52px', fontSize: '0.75rem', borderRadius: '12px' }}
              >
                <iconify-icon icon="tabler:search" style={{ fontSize: '0.9rem' }} />
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
              <button type="button" className="btn-fenix btn-dark" style={{ height: '64px', fontSize: '0.75rem' }} onClick={() => setModalBusca(false)}>
                <iconify-icon icon="tabler:arrow-left" />
                Voltar
              </button>
              {produtoEncontrado && (
                <button type="button" className="btn-fenix btn-green" style={{ height: '64px', fontSize: '0.75rem' }} onClick={handleAdicionarProduto}>
                  <iconify-icon icon="tabler:circle-plus" />
                  Adicionar à compra
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="operacao-header reveal d-1 active">
        <button className="btn-voltar" onClick={() => navigate('/inicio')}>
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
            <span style={{ textAlign: 'right' }}>Unit.</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>

          <div className="lista-itens">
            {itens.length === 0 ? (
              <div className="lista-vazia">
                <iconify-icon icon="tabler:barcode" />
                <span className="lista-vazia-txt">Passe o produto no leitor</span>
              </div>
            ) : (
              itens.map(item => (
                <div
                  key={item.id}
                  className={[
                    'item-linha',
                    itemSelecionado === item.id ? 'item-selecionado' : '',
                    modoExclusao ? 'item-modo-exclusao' : '',
                  ].join(' ')}
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
            <span className="subtotal-label">Total da compra</span>
            <span className="subtotal-valor">R$ {total.toFixed(2)}</span>
          </div>
        </div>

        {/* Coluna direita: controles */}
        <aside className="controles-col reveal-blur d-3 active">

          {/* Barcode form */}
          <form onSubmit={handleCodigoSubmit} className="barcode-card">
            <span className="barcode-label label-mono">
              <iconify-icon icon="tabler:barcode" style={{ fontSize: '0.9rem', marginRight: '0.3rem' }} />
              Código de barras
            </span>
            <input
              ref={inputRef}
              type="text"
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              placeholder="Aguardando leitura…"
              className="barcode-input"
              autoComplete="off"
              disabled={carregando || verificandoPeso || aprendendoPeso || modoPassarProduto}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-fenix btn-dark"
                onClick={() => setModalBusca(true)}
                style={{ height: '52px', fontSize: '0.75rem', flex: 1, padding: '0 1rem', borderRadius: '12px' }}
              >
                <iconify-icon icon="tabler:search" style={{ fontSize: '0.9rem' }} />
                Buscar
              </button>
              <button
                type="button"
                className={`btn-fenix ${quantidadePendente > 1 ? 'btn-blue' : 'btn-dark'}`}
                onClick={() => {
                  setDigQuantidade(quantidadePendente > 1 ? String(quantidadePendente) : '')
                  setModalQuantidade(true)
                }}
                style={{ height: '52px', fontSize: '0.75rem', flex: 1, padding: '0 1rem', borderRadius: '12px', fontWeight: quantidadePendente > 1 ? 700 : 400 }}
              >
                <iconify-icon icon="tabler:packages" style={{ fontSize: '0.9rem' }} />
                {quantidadePendente > 1 ? `${quantidadePendente}×` : 'Qtd'}
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

          {/* Aguardando produto na balança (verificando peso cadastrado) */}
          {verificandoPeso && (
            <div className="aviso-balanca aviso-balanca--verificar reveal active">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                <iconify-icon icon="tabler:scale" style={{ fontSize: '1.1rem' }} />
                <span>Coloque o produto no balcão…</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{contagemBalanca}s</span>
              </div>
            </div>
          )}

          {/* Aprendendo peso — qty=1 ou qty>1 sem FORMATO_PRO */}
          {aprendendoPeso && (
            <div className="aviso-balanca aviso-balanca--aprender reveal active">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                <iconify-icon icon="tabler:scale-outline" style={{ fontSize: '1.1rem' }} />
                <span>
                  {quantidadePendente > 1
                    ? `Coloque os ${quantidadePendente} itens no balcão…`
                    : 'Coloque o produto no balcão…'}
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{contagemBalanca}s</span>
              </div>
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="operacao-erro reveal active">
              <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
              {erro}
            </div>
          )}

          {/* Botões de ação */}
          <div className="botoes-acao">
            <button
              className="btn-fenix btn-red"
              onClick={() => navigate('/autorizacao?acao=cancelar-conta')}
              disabled={itens.length === 0}
              style={{ height: '80px', fontSize: '0.9rem', borderRadius: '16px' }}
            >
              <iconify-icon icon="tabler:circle-x" style={{ fontSize: '1.5rem' }} />
              Cancelar conta
            </button>

            <button
              className="btn-fenix btn-orange"
              onClick={handleCancelarItemClick}
              disabled={itens.length === 0}
              style={{ height: '80px', fontSize: '0.9rem', borderRadius: '16px', boxShadow: modoExclusao ? '0 0 0 3px rgba(200,113,11,0.4), 0px 7px 20px rgba(200,113,11,0.35)' : '0px 7px 20px rgba(200,113,11,0.35)' }}
            >
              <iconify-icon icon="tabler:trash" style={{ fontSize: '1.5rem' }} />
              {modoExclusao ? 'Selecione um item…' : 'Cancelar item'}
            </button>

            <button
              className="btn-fenix btn-green"
              onClick={handlePagamento}
              disabled={itens.length === 0 || verificandoTotal}
              style={{ height: '80px', fontSize: '0.9rem', borderRadius: '16px', gridColumn: 'span 2' }}
            >
              <iconify-icon icon="tabler:credit-card" style={{ fontSize: '1.5rem' }} />
              {verificandoTotal ? 'Verificando…' : 'Pagamento'}
            </button>
          </div>

        </aside>
      </main>
    </div>
  )
}
