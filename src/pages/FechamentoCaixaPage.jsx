import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCaixaStore } from '../store/caixaStore'
import { fecharCaixa } from '../services/api'
import './FechamentoCaixaPage.css'

export default function FechamentoCaixaPage() {
  const navigate = useNavigate()
  const { apelido, nmEstacao, dataAbertura, fecharCaixa: fecharCaixaStore } = useCaixaStore()

  const dataAberturaFormatada = dataAbertura
    ? new Date(dataAbertura).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  const [fechando, setFechando]   = useState(false)
  const [sucesso, setSucesso]     = useState(false)
  const [erro, setErro]           = useState('')

  async function handleFechar(e) {
    e.preventDefault()
    setFechando(true)
    setErro('')
    try {
      await fecharCaixa()
      setSucesso(true)
      setTimeout(() => { fecharCaixaStore(); navigate('/') }, 3000)
    } catch (err) {
      setErro(err.message)
      setFechando(false)
    }
  }

  if (sucesso) {
    return (
      <div className="fechamento-root">
        <div className="fechamento-orb fechamento-orb-1" />
        <div className="fechamento-orb fechamento-orb-2" />
        <div className="fechamento-sucesso-card reveal-blur active">
          <div className="fechamento-sucesso-icon pulse-dot" style={{width: '96px', height: '96px', background: 'rgba(0,205,43,0.1)', animation: 'none', boxShadow: 'none'}}>
            <iconify-icon icon="tabler:shield-check" style={{ fontSize: '3rem', color: 'var(--fenix-green)' }} />
          </div>
          <h2 className="fechamento-sucesso-titulo reveal d-1 active">Caixa fechado!</h2>
          {apelido && <p className="reveal d-2 active" style={{ color: 'var(--ink-muted)', fontSize: '1rem' }}>Turno de <strong>{apelido}</strong> encerrado.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="fechamento-root">
      <div className="fechamento-orb fechamento-orb-1" />
      <div className="fechamento-orb fechamento-orb-2" />

      <div className="fechamento-card reveal-blur active">

        {/* Label de contexto */}
        <p className="fechamento-page-label label-mono">
          <iconify-icon icon="tabler:cash-register" />
          Fechamento de Caixa
        </p>

        <div className="fechamento-icon-wrap reveal d-1 active">
          <img src="/caixalivre-icon.svg" alt="CaixaLivre" className="fechamento-logo-svg" />
        </div>

        <h1 className="fechamento-title reveal d-2 active">Fechar o caixa?</h1>

        <div className="fechamento-info-estacao reveal d-3 active">
          <span><iconify-icon icon="tabler:device-desktop" /> {nmEstacao || '—'}</span>
          <span><iconify-icon icon="tabler:clock" /> {dataAberturaFormatada || 'Abertura não registrada'}</span>
        </div>

        {erro && (
          <div className="fechamento-erro reveal active">
            <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
            {erro}
          </div>
        )}

        <div className="fechamento-btn-wrap reveal d-3 active">
          <button
            className="btn-fenix btn-dark"
            onClick={handleFechar}
            disabled={fechando}
          >
              <iconify-icon icon="tabler:cash-register" style={{ fontSize: '1.6rem' }} />
            {fechando ? 'Fechando…' : 'Fechar Caixa'}
          </button>

          <button
            className="btn-fenix btn-neutral"
            onClick={() => navigate('/')}
            disabled={fechando}
            style={{ height: '56px', fontSize: '1rem', background: 'transparent', color: 'var(--ink-muted)', boxShadow: 'none', border: '1px solid rgba(0,139,195,0.2)' }}
          >
            <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1.2rem' }} />
            Voltar à operação
          </button>

          <button
            className="btn-fenix btn-neutral"
            onClick={() => window.close()}
            disabled={fechando}
            style={{ height: '56px', fontSize: '1rem', background: 'transparent', color: 'var(--ink-muted)', boxShadow: 'none', border: '1px solid rgba(0,139,195,0.2)' }}
          >
            <iconify-icon icon="tabler:logout" style={{ fontSize: '1.2rem' }} />
            Sair
          </button>
        </div>

      </div>
    </div>
  )
}
