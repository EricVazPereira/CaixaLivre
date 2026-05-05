import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCaixaStore } from '../store/caixaStore'
import { fecharCaixa } from '../services/api'
import './FechamentoCaixaPage.css'

export default function FechamentoCaixaPage() {
  const navigate = useNavigate()
  const { apelido, fecharCaixa: fecharCaixaStore } = useCaixaStore()

  const [fechando, setFechando]   = useState(false)
  const [sucesso, setSucesso]     = useState(false)
  const [mensagem, setMensagem]   = useState('')
  const [erro, setErro]           = useState('')

  async function handleFechar(e) {
    e.preventDefault()
    setFechando(true)
    setErro('')
    try {
      const data = await fecharCaixa()
      setMensagem(data.mensagem || 'Caixa fechado com sucesso!')
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
          {apelido && <p className="reveal d-2 active" style={{ color: 'var(--ink-muted)', fontSize: '0.95rem' }}>Turno de <strong>{apelido}</strong> encerrado.</p>}
          {mensagem && <p className="fechamento-sucesso-msg reveal d-3 active">{mensagem}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="fechamento-root">
      <div className="fechamento-orb fechamento-orb-1" />
      <div className="fechamento-orb fechamento-orb-2" />

      <div className="fechamento-card reveal-blur active">

        <div className="fechamento-icon-wrap reveal d-1 active">
          <iconify-icon icon="tabler:lock" />
        </div>

        <h1 className="fechamento-title reveal d-2 active">Fechar Caixa</h1>

        <p className="fechamento-desc reveal d-3 active">
          {apelido
            ? <>Deseja encerrar o turno de <strong>{apelido}</strong> e fechar o caixa?</>
            : 'Deseja encerrar o turno e fechar o caixa?'
          }
        </p>

        {erro && (
          <div className="fechamento-erro reveal active">
            <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
            {erro}
          </div>
        )}

        <div className="fechamento-btn-wrap reveal d-4 active">
          <button
            className="btn-fenix btn-dark"
            onClick={handleFechar}
            disabled={fechando}
          >
            <iconify-icon icon="tabler:lock" style={{ fontSize: '1.6rem' }} />
            {fechando ? 'Fechando…' : 'Fechar Caixa'}
          </button>

          <button
            className="btn-fenix btn-neutral"
            onClick={() => navigate('/operacao')}
            disabled={fechando}
            style={{ height: '56px', fontSize: '0.75rem', background: 'transparent', color: 'var(--ink-muted)', boxShadow: 'none', border: '1px solid rgba(0,139,195,0.2)' }}
          >
            <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1.2rem' }} />
            Voltar à operação
          </button>
        </div>

      </div>
    </div>
  )
}
