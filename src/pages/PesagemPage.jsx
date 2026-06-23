import { useState, useEffect, useRef, useCallback } from 'react'
import { lerPesoTotem, buscarFamilias, buscarProdutosFamilia, buscarProdutosPesagem } from '../services/api'
import IconBalancaTotem from '../components/IconBalancaTotem'
import './PesagemPage.css'

// Ícones por nome de família
function iconeParaFamilia(descricao) {
  const d = (descricao || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (d.includes('padaria') || d.includes('pao'))                            return 'tabler:bread'
  if (d.includes('horti')   || d.includes('frut') || d.includes('verdu'))   return 'tabler:plant-2'
  if (d.includes('acougu')  || d.includes('carne'))                         return 'tabler:meat'
  if (d.includes('frio')    || d.includes('resfri') || d.includes('gelad')) return 'tabler:snowflake'
  if (d.includes('latic')   || d.includes('queijo') || d.includes('leite')) return 'tabler:cheese'
  if (d.includes('granel')  || d.includes('cereal'))                        return 'tabler:grain'
  if (d.includes('doce')    || d.includes('confeit'))                       return 'tabler:cake'
  if (d.includes('peixe')   || d.includes('frutos'))                        return 'tabler:fish'
  if (d.includes('bebida')  || d.includes('drink'))                         return 'tabler:cup'
  if (d.includes('cigarro') || d.includes('fumo'))                          return 'tabler:smoking'
  return 'tabler:package'
}

function formatarPeso(gramas) {
  if (gramas == null) return '—'
  if (gramas >= 1000) return `${(gramas / 1000).toFixed(3).replace('.', ',')} kg`
  return `${gramas} g`
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const ESTABILIDADE_MS = 1000
const PESO_MINIMO_G   = 30
const VARIACAO_MAX_G  = 25
const POLL_MS         = 300

// ── Teclado virtual ──────────────────────────────────────────────────────────
const TECLADO_LINHAS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M','⌫'],
  ['ESPAÇO'],
]

function TecladoVirtual({ onTecla }) {
  return (
    <div className="pesagem-teclado">
      {TECLADO_LINHAS.map((linha, li) => (
        <div key={li} className="pesagem-teclado-linha">
          {linha.map(k => (
            <button
              key={k}
              type="button"
              className={[
                'pesagem-teclado-tecla',
                k === 'ESPAÇO' ? 'pesagem-teclado-tecla--espaco' : '',
                k === '⌫'      ? 'pesagem-teclado-tecla--back'   : '',
              ].join(' ').trim()}
              onClick={() => onTecla(k)}
            >
              {k === '⌫'
                ? <iconify-icon icon="tabler:backspace" />
                : k}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Card de produto reutilizável ──────────────────────────────────────────────
function ProdutoCard({ produto, onClick }) {
  return (
    <button
      type="button"
      className="pesagem-familia-card pesagem-familia-card--produto"
      onClick={() => onClick(produto)}
    >
      <span>{produto.descricao}</span>
      <span className="pesagem-produto-preco-kg">
        {formatarMoeda(produto.valor_por_kg)}/kg
      </span>
    </button>
  )
}

export default function PesagemPage({ onFechar, onRegistrar }) {

  const [etapa,              setEtapa]              = useState('produtos')
  const [familias,           setFamilias]           = useState([])
  const [familiaSelecionada, setFamiliaSelecionada] = useState(null)
  const [produtos,           setProdutos]           = useState([])
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [carregandoFamilias, setCarregandoFamilias] = useState(true)
  const [carregandoProdutos, setCarregandoProdutos] = useState(false)
  const [erroFamilias,       setErroFamilias]       = useState('')
  const [erroProdutos,       setErroProdutos]       = useState('')

  // ── Busca
  const [modalBusca,    setModalBusca]    = useState(false)
  const [termoBusca,    setTermoBusca]    = useState('')
  const [produtosBusca, setProdutosBusca] = useState([])
  const [buscando,      setBuscando]      = useState(false)
  const buscaInputRef = useRef(null)

  // ── Balança
  const [pesoAtual,   setPesoAtual]   = useState(null)
  const [registrando, setRegistrando] = useState(false)

  const pollingRef     = useRef(null)
  const ultimoPesoRef  = useRef(null)
  const stableTimerRef = useRef(null)
  const registrandoRef = useRef(false)
  const produtoRef     = useRef(null)
  produtoRef.current   = produtoSelecionado

  // ── Carrega famílias ──────────────────────────────────────────────────────────
  useEffect(() => {
    buscarFamilias()
      .then(f => {
        setFamilias(f)
        if (f.length > 0) setFamiliaSelecionada(f[0])
      })
      .catch(e => setErroFamilias(e.message))
      .finally(() => setCarregandoFamilias(false))
  }, [])

  // ── Carrega produtos da família selecionada ───────────────────────────────────
  useEffect(() => {
    if (!familiaSelecionada) return
    setCarregandoProdutos(true)
    setErroProdutos('')
    setProdutos([])
    buscarProdutosFamilia(familiaSelecionada.codigo)
      .then(p => setProdutos(p))
      .catch(e => setErroProdutos(e.message))
      .finally(() => setCarregandoProdutos(false))
  }, [familiaSelecionada])

  // ── Busca textual (debounce 300ms) ────────────────────────────────────────────
  useEffect(() => {
    if (!modalBusca) return
    if (!termoBusca.trim()) { setProdutosBusca([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const res = await buscarProdutosPesagem(termoBusca)
        setProdutosBusca(res)
      } catch {
        setProdutosBusca([])
      } finally {
        setBuscando(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [termoBusca, modalBusca])

  // ── Foca input ao abrir modal busca ─────────────────────────────────────────
  useEffect(() => {
    if (modalBusca) setTimeout(() => buscaInputRef.current?.focus(), 80)
    else { setTermoBusca(''); setProdutosBusca([]) }
  }, [modalBusca])

  // ── Registro ─────────────────────────────────────────────────────────────────
  const registrarPeso = useCallback((pesoGramas) => {
    if (registrandoRef.current || !produtoRef.current) return
    registrandoRef.current = true
    setRegistrando(true)
    const produto = produtoRef.current
    onRegistrar?.({
      codigo:         produto.codigo,
      descricao:      produto.descricao,
      valor_unitario: produto.valor_por_kg,
      unidade:        'KG',
      peso_gramas:    pesoGramas,
      tipo_pesagem:   true,
    }, pesoGramas / 1000)
  }, [onRegistrar])

  // ── Polling da balança ────────────────────────────────────────────────────────
  useEffect(() => {
    if (etapa !== 'balanca') {
      clearInterval(pollingRef.current)
      clearTimeout(stableTimerRef.current)
      return
    }
    ultimoPesoRef.current  = null
    stableTimerRef.current = null

    async function poll() {
      const r = await lerPesoTotem()
      if (!r.ok || r.desabilitada) return
      const peso = r.peso_gramas ?? 0
      setPesoAtual(peso)
      if (peso < PESO_MINIMO_G) {
        clearTimeout(stableTimerRef.current)
        stableTimerRef.current = null
        ultimoPesoRef.current  = null
        return
      }
      const variou = ultimoPesoRef.current === null ||
                     Math.abs(peso - ultimoPesoRef.current) > VARIACAO_MAX_G
      if (variou) {
        clearTimeout(stableTimerRef.current)
        stableTimerRef.current = null
        ultimoPesoRef.current  = peso
      } else if (!stableTimerRef.current) {
        stableTimerRef.current = setTimeout(() => registrarPeso(peso), ESTABILIDADE_MS)
      }
    }

    poll()
    pollingRef.current = setInterval(poll, POLL_MS)
    return () => { clearInterval(pollingRef.current); clearTimeout(stableTimerRef.current) }
  }, [etapa, registrarPeso])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function handleSelecionarProduto(produto) {
    setModalBusca(false)
    setProdutoSelecionado(produto)
    setPesoAtual(null)
    setEtapa('balanca')
  }

  function handleVoltar() {
    if (modalBusca) { setModalBusca(false); return }
    if (etapa === 'balanca') {
      setProdutoSelecionado(null)
      registrandoRef.current = false
      setRegistrando(false)
      setEtapa('produtos')
      return
    }
    onFechar?.()
  }

  const pesoValido = pesoAtual != null && pesoAtual >= PESO_MINIMO_G

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="pesagem-root">
      <div className="pesagem-card reveal-blur active">

        {/* ══════════ ETAPA: categorias + produtos ══════════ */}
        {etapa === 'produtos' && (
          <>
            {/* ── Linha: botão voltar + tabs de categoria ── */}
            <div className="pesagem-categorias">
              <button className="pesagem-btn-voltar" onClick={handleVoltar} type="button">
                <iconify-icon icon="tabler:arrow-left" />
              </button>

              {carregandoFamilias && (
                <div className="pesagem-loading">
                  <iconify-icon icon="tabler:loader-2" class="spin" />
                </div>
              )}
              {erroFamilias && (
                <div className="pesagem-erro">
                  <iconify-icon icon="tabler:alert-triangle" />{erroFamilias}
                </div>
              )}
              {!carregandoFamilias && !erroFamilias && familias.map(f => (
                <button
                  key={f.codigo}
                  type="button"
                  className={`pesagem-cat-tab${familiaSelecionada?.codigo === f.codigo ? ' ativo' : ''}`}
                  onClick={() => setFamiliaSelecionada(f)}
                >
                  <iconify-icon icon={iconeParaFamilia(f.descricao)} />
                  <span>{f.descricao}</span>
                </button>
              ))}
            </div>

            {/* ── Barra de busca ── */}
            <button
              type="button"
              className="pesagem-barra-busca"
              onClick={() => setModalBusca(true)}
            >
              <iconify-icon icon="tabler:search" />
              <span>Buscar produto</span>
            </button>

            {/* ── Grid de produtos (scroll horizontal) ── */}
            <div className="pesagem-produtos-area">
              {carregandoProdutos && (
                <div className="pesagem-loading">
                  <iconify-icon icon="tabler:loader-2" class="spin" />Carregando…
                </div>
              )}
              {erroProdutos && (
                <div className="pesagem-erro">
                  <iconify-icon icon="tabler:alert-triangle" />{erroProdutos}
                </div>
              )}
              {!carregandoProdutos && !erroProdutos && (
                <div
                  className="pesagem-produtos-grid"
                  style={{ gridTemplateColumns: `repeat(${Math.max(5, Math.ceil(produtos.length / 2))}, 109px)` }}
                >
                  {produtos.map(p => (
                    <ProdutoCard key={p.codigo} produto={p} onClick={handleSelecionarProduto} />
                  ))}
                  {produtos.length === 0 && (
                    <p className="pesagem-vazio">Nenhum produto nesta categoria.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════ ETAPA: balança ══════════ */}
        {etapa === 'balanca' && (
          <div className="pesagem-etapa pesagem-etapa--balanca">
            <button className="pesagem-btn-voltar pesagem-btn-voltar--standalone" onClick={handleVoltar} type="button">
              <iconify-icon icon="tabler:arrow-left" />
            </button>

            <div className="pesagem-chip">
              <iconify-icon icon={iconeParaFamilia(familiaSelecionada?.descricao)} />
              {produtoSelecionado?.descricao}
            </div>

            <div className="pesagem-balanca-icon-wrap">
              <IconBalancaTotem size="1em" color="currentColor" />
              {pesoValido && <div className="pesagem-balanca-pulse" />}
            </div>

            <h1 className="pesagem-titulo">
              {pesoValido ? 'Estabilizando…' : 'Coloque o produto na balança'}
            </h1>

            <div className={`pesagem-display${pesoValido ? ' pesagem-display--ok' : ''}`}>
              <span className="pesagem-display-valor">
                {pesoValido ? formatarPeso(pesoAtual) : '—'}
              </span>
              {pesoValido && produtoSelecionado && (
                <span className="pesagem-display-total">
                  {formatarMoeda((pesoAtual / 1000) * produtoSelecionado.valor_por_kg)}
                </span>
              )}
            </div>

            {registrando && (
              <div className="pesagem-loading">
                <iconify-icon icon="tabler:loader-2" class="spin" />Registrando…
              </div>
            )}
          </div>
        )}

        {/* ══════════ TELA: busca com teclado ══════════ */}
        {modalBusca && (
          <div className="pesagem-busca-overlay">

            {/* ── Barra de busca ── */}
            <div className="pesagem-busca-header">
              <button className="pesagem-btn-voltar" onClick={() => setModalBusca(false)} type="button">
                <iconify-icon icon="tabler:arrow-left" />
              </button>
              <div className="pesagem-busca-input-wrap">
                <iconify-icon icon="tabler:search" />
                <span className="pesagem-busca-display">
                  {termoBusca || <span className="pesagem-busca-placeholder">Digite o nome do produto…</span>}
                </span>
                {termoBusca && (
                  <button type="button" className="pesagem-busca-limpar" onClick={() => setTermoBusca('')}>
                    <iconify-icon icon="tabler:x" />
                  </button>
                )}
              </div>
            </div>

            {/* ── Resultados ── */}
            <div className="pesagem-busca-resultados">
              {buscando && (
                <div className="pesagem-loading">
                  <iconify-icon icon="tabler:loader-2" class="spin" />Buscando…
                </div>
              )}
              {!buscando && !termoBusca && (
                <p className="pesagem-vazio">Use o teclado para buscar um produto.</p>
              )}
              {!buscando && termoBusca && produtosBusca.length === 0 && (
                <p className="pesagem-vazio">Nenhum produto encontrado para "{termoBusca}".</p>
              )}
              {!buscando && produtosBusca.length > 0 && (
                <div className="pesagem-busca-grid">
                  {produtosBusca.map(p => (
                    <ProdutoCard key={p.codigo} produto={p} onClick={handleSelecionarProduto} />
                  ))}
                </div>
              )}
            </div>

            {/* ── Teclado virtual ── */}
            <TecladoVirtual onTecla={k => {
              if (k === '⌫')      setTermoBusca(t => t.slice(0, -1))
              else if (k === 'ESPAÇO') setTermoBusca(t => t + ' ')
              else                setTermoBusca(t => t + k.toLowerCase())
            }} />

          </div>
        )}

      </div>
    </div>
  )
}
