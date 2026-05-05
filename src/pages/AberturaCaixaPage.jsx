import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCaixaStore } from '../store/caixaStore'
import { verificarStatusCaixa, abrirCaixa, testarBalanca } from '../services/api'
import './AberturaCaixaPage.css'

export default function AberturaCaixaPage() {
  const navigate = useNavigate()
  const { abrirCaixa: abrirCaixaStore } = useCaixaStore()

  const [status, setStatus]           = useState(null)
  const [carregando, setCarregando]   = useState(true)
  const [abrindo, setAbrindo]         = useState(false)
  const [erro, setErro]               = useState('')
  const [balancaOk, setBalancaOk]     = useState(true)

  useEffect(() => { verificar() }, [])

  async function verificar() {
    setCarregando(true)
    setErro('')
    try {
      // Verifica caixa e balança em paralelo
      const [data, balanca] = await Promise.all([
        verificarStatusCaixa(),
        testarBalanca(),
      ])
      // Só mostra aviso se balança está habilitada E não comunicou
      setBalancaOk(!balanca.habilitada || balanca.ok)
      setStatus(data)
      if (data.aberto) {
        abrirCaixaStore({ idHistorico: data.id_historico, nomeOperador: '', apelido: '', cdOperador: 0 })
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
      if (!data.id_historico) throw new Error('Caixa aberto no ERP mas histórico não encontrado.')
      abrirCaixaStore({ idHistorico: data.id_historico, nomeOperador: '', apelido: '', cdOperador: 0 })
      navigate('/inicio')
    } catch (e) {
      setErro(e.message)
    } finally {
      setAbrindo(false)
    }
  }

  return (
    <div className="abertura-root">
      <div className="abertura-orb abertura-orb-1" />
      <div className="abertura-orb abertura-orb-2" />

      <div className="abertura-card">

        {/* Logo mark */}
        <div className="abertura-logo-mark reveal-blur active">
          <iconify-icon icon="tabler:device-tablet" style={{ color: 'white', fontSize: '2rem' }} />
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

            {!balancaOk && (
              <div className="abertura-aviso-balanca reveal d-4 active">
                <iconify-icon icon="tabler:scale-off" style={{ fontSize: '1.4rem', flexShrink: 0 }} />
                <div>
                  <strong>Balança desconectada</strong>
                  <span>Verifique o cabo e ligue a balança antes de começar o atendimento.</span>
                </div>
              </div>
            )}

            {!status.aberto && (
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
