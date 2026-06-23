import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCaixaStore } from '../store/caixaStore'
import { verificarStatusCaixa, abrirCaixa, testarBalanca } from '../services/api'
import IconBalanca from '../components/IconBalanca'
import './AberturaCaixaPage.css'

export default function AberturaCaixaPage() {
  const navigate = useNavigate()
  const { abrirCaixa: abrirCaixaStore } = useCaixaStore()

  const [status, setStatus]                 = useState(null)
  const [carregando, setCarregando]         = useState(true)
  const [abrindo, setAbrindo]               = useState(false)
  const [erro, setErro]                     = useState('')
  const [balancaOk, setBalancaOk]           = useState(true)
  const [modoSemBalanca, setModoSemBalanca] = useState(false)
  const [estacaoNaoCadastrada, setEstacaoNaoCadastrada] = useState(false)

  // Gatilho invisível — segure 1,5s no canto superior direito para revelar "Sair"
  const [adminVisible, setAdminVisible] = useState(false)
  const pressTimer = useRef(null)
  const hideTimer  = useRef(null)

  useEffect(() => {
    if (adminVisible) {
      hideTimer.current = setTimeout(() => setAdminVisible(false), 4000)
    }
    return () => clearTimeout(hideTimer.current)
  }, [adminVisible])

  const startPress = (e) => {
    e.stopPropagation()
    pressTimer.current = setTimeout(() => setAdminVisible(true), 1500)
  }
  const cancelPress = (e) => {
    e?.stopPropagation()
    clearTimeout(pressTimer.current)
  }

  useEffect(() => { verificar() }, [])

  async function verificar() {
    setCarregando(true)
    setErro('')
    setEstacaoNaoCadastrada(false)
    try {
      // Verifica caixa e balança em paralelo
      const [data, balanca] = await Promise.all([
        verificarStatusCaixa(),
        testarBalanca(),
      ])
      // Só mostra aviso se balança está habilitada E não comunicou
      setBalancaOk(!balanca.habilitada || balanca.ok)

      if (data.estacao_nao_cadastrada) {
        setEstacaoNaoCadastrada(true)
        setStatus(data)
        return
      }

      setStatus(data)
      if (data.aberto) {
        abrirCaixaStore({ idHistorico: null, nomeOperador: '', apelido: '', cdOperador: 0, nmEstacao: data.nm_estacao || '' })
        navigate('/inicio')
      }
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  async function handleAbrirCaixa() {
    setAbrindo(true)
    setErro('')
    try {
      const data = await abrirCaixa()
      abrirCaixaStore({ idHistorico: null, nomeOperador: '', apelido: '', cdOperador: 0, nmEstacao: status?.nm_estacao || data.nm_estacao || '' })
      navigate('/inicio')
    } catch (e) {
      setErro(e.message)
    } finally {
      setAbrindo(false)
    }
  }

  // ── Tela dedicada quando balança não responde ─────────────────────────────
  if (!balancaOk && !modoSemBalanca && !carregando) {
    return (
      <div className="abertura-root">
        <div className="abertura-orb abertura-orb-1" />
        <div className="abertura-orb abertura-orb-2" />

        <div className="abertura-card">
          <div className="abertura-balanca-icone reveal-blur active">
            <IconBalanca size={48} />
          </div>

          <h2 className="abertura-balanca-titulo reveal d-1 active">
            A balança não está respondendo
          </h2>
          <p className="abertura-balanca-sub reveal d-2 active">
            Verifique se o cabo está conectado.
          </p>

          <div className="abertura-btn-wrap reveal d-3 active">
            <button
              className="btn-fenix btn-blue"
              onClick={verificar}
              disabled={carregando}
            >
              <IconBalanca size={20} />
              Tentar novamente
            </button>
            <button
              className="btn-fenix"
              onClick={() => setModoSemBalanca(true)}
              style={{
                background: 'transparent',
                color: 'var(--ink-muted)',
                boxShadow: 'none',
                border: '1px solid rgba(0,139,195,0.20)',
                height: '56px',
                fontSize: '1rem',
              }}
            >
              Continuar sem balança
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="abertura-root">
      <div className="abertura-orb abertura-orb-1" />
      <div className="abertura-orb abertura-orb-2" />

      {/* Gatilho invisível no canto superior direito — segure 1,5s para revelar "Sair" */}
      <div
        className="abertura-admin-trigger"
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
        onClick={e => e.stopPropagation()}
      />

      {adminVisible && (
        <div className="abertura-admin-panel" onClick={e => e.stopPropagation()}>
          <button
            className="abertura-admin-btn"
            onClick={() => window.close()}
          >
            <iconify-icon icon="tabler:logout" />
            Sair
          </button>
        </div>
      )}

      <div className="abertura-card">

        {/* Label de contexto */}
        <p className="abertura-page-label label-mono">
          <iconify-icon icon="tabler:cash-register" />
          Abertura de Caixa
        </p>

        {/* Logo mark */}
        <div className="abertura-logo-mark reveal-blur active">
          <img src="/caixalivre-icon.svg" alt="CaixaLivre" className="cl-logo-svg" />
        </div>

        {/* Título */}
        <h1 className="abertura-title reveal d-1 active">
          Caixa<span>Livre</span>
        </h1>

        {/* Carregando */}
        {carregando && (
          <div className="abertura-loading">
            <div className="abertura-spinner" />
            <span>Verificando status do caixa…</span>
          </div>
        )}

        {/* Status + botão */}
        {!carregando && status && (
          <>
            <div className="abertura-estacao reveal d-2 active">
              <iconify-icon icon="tabler:device-desktop" />
              {status.nm_estacao}
            </div>

            <div className={`abertura-status reveal d-3 active ${status.aberto ? 'abertura-status--aberto' : 'abertura-status--fechado'}`}>
              <span className={`status-dot ${status.aberto ? 'status-dot--verde' : 'status-dot--vermelho'}`} />
              {status.aberto ? 'Caixa Aberto' : 'Caixa Fechado'}
            </div>

            {estacaoNaoCadastrada && (
              <div className="abertura-erro reveal active" style={{ flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center' }}>
                <iconify-icon icon="tabler:device-desktop-off" style={{ fontSize: '2rem', flexShrink: 0 }} />
                <div>
                  <strong>Estação não cadastrada</strong>
                  <span style={{ display: 'block', fontSize: '1rem', marginTop: '0.25rem', opacity: 0.8 }}>
                    A estação <strong>{status?.nm_estacao}</strong> não está registrada no sistema.<br />
                    Chame o administrador para cadastrá-la.
                  </span>
                </div>
              </div>
            )}

            {!status.aberto && !estacaoNaoCadastrada && (
              <div className="abertura-btn-wrap reveal d-5 active">
                <button
                  className="btn-fenix btn-blue"
                  onClick={handleAbrirCaixa}
                  disabled={abrindo}
                >
                  <iconify-icon icon="tabler:lock-open" style={{ fontSize: '1.6rem' }} />
                  {abrindo ? 'Abrindo…' : 'Abrir Caixa'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Erro */}
        {erro && (
          <>
            <div className="abertura-erro reveal active">
              <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.2rem', flexShrink: 0 }} />
              {erro}
            </div>
            <div className="abertura-btn-wrap reveal d-1 active">
              <button className="btn-fenix btn-dark" onClick={verificar}>
                <iconify-icon icon="tabler:refresh" style={{ fontSize: '1.4rem' }} />
                Tentar novamente
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
