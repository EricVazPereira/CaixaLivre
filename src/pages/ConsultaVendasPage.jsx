import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './ConsultaVendasPage.css'

const FORMA_LABEL = { credito: 'Crédito', debito: 'Débito', pix: 'PIX' }
const FORMA_ICON  = {
  credito: 'tabler:credit-card',
  debito:  'tabler:credit-card-pay',
  pix:     'tabler:qrcode',
}
const STATUS_LABEL = {
  paga:      { texto: 'Paga',      classe: 'status--paga' },
  cancelada: { texto: 'Cancelada', classe: 'status--cancelada' },
  aberta:    { texto: 'Aberta',    classe: 'status--aberta' },
}

export default function ConsultaVendasPage() {
  const navigate = useNavigate()
  const [contas, setContas]     = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]         = useState('')

  useEffect(() => {
    fetch('http://localhost:3001/api/contas?itens=true')
      .then(r => r.json())
      .then(data => { setContas(data); setCarregando(false) })
      .catch(() => { setErro('Erro ao carregar vendas.'); setCarregando(false) })
  }, [])

  const totalGeral  = contas.filter(c => c.status === 'paga').reduce((acc, c) => acc + c.valor_total, 0)
  const qtPagas     = contas.filter(c => c.status === 'paga').length
  const qtCanceladas= contas.filter(c => c.status === 'cancelada').length

  return (
    <div className="consulta-root">

      {/* Header */}
      <header className="consulta-header reveal d-1 active">
        <button className="btn-voltar" onClick={() => navigate('/operacao')} style={{
          display:'inline-flex', alignItems:'center', gap:'0.4rem',
          padding:'0 1.25rem', height:'44px', borderRadius:'9999px',
          border:'1px solid rgba(0,139,195,0.2)', background:'transparent',
          fontFamily:'Montserrat,sans-serif', fontSize:'0.85rem', fontWeight:700,
          color:'var(--ink-muted)', cursor:'pointer', transition: 'all 0.2s'
        }}>
          <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1.2rem' }} />
          Voltar
        </button>
        <span className="consulta-header-logo">Caixa<span>Livre</span></span>
        <span className="consulta-header-sub label-mono">Consulta de Vendas</span>
      </header>

      <main className="consulta-main">

        {/* Stats */}
        <div className="stats-row reveal-blur d-2 active">
          <div className="stat-card">
            <span className="stat-card-label label-mono">Total de cupons</span>
            <span className="stat-card-valor">{contas.length}</span>
          </div>
          <div className="stat-card stat-card--destaque">
            <span className="stat-card-label label-mono">Total faturado</span>
            <span className="stat-card-valor">R$ {totalGeral.toFixed(2)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label label-mono">Pagos</span>
            <span className="stat-card-valor">{qtPagas}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label label-mono">Cancelados</span>
            <span className="stat-card-valor">{qtCanceladas}</span>
          </div>
        </div>

        {/* Lista */}
        <span className="cupons-section-title label-mono reveal d-3 active">
          <iconify-icon icon="tabler:receipt" style={{ fontSize: '1.1rem', marginRight: '0.3rem' }} />
          Cupons do turno
        </span>

        <div className="cupons-lista reveal-blur d-4 active">
          {carregando && <p className="consulta-msg">Carregando vendas…</p>}
          {erro       && <p className="consulta-msg consulta-msg--erro">{erro}</p>}
          {!carregando && !erro && contas.length === 0 && (
            <p className="consulta-msg">Nenhuma venda registrada ainda.</p>
          )}

          {contas.map(conta => {
            const st = STATUS_LABEL[conta.status] ?? STATUS_LABEL.aberta
            return (
              <div key={conta.id} className={`cupom-card ${conta.status === 'cancelada' ? 'cupom-card--cancelado' : ''}`}>
                <div className="cupom-header">
                  <span className="cupom-id">#{String(conta.id).padStart(4, '0')}</span>
                  <div className="cupom-info">
                    <span className="cupom-data">{conta.data_hora}</span>
                    <span className="cupom-forma">
                      {conta.forma_pagamento && (
                        <iconify-icon icon={FORMA_ICON[conta.forma_pagamento] || 'tabler:credit-card'} style={{ fontSize: '1rem', marginRight: '0.25rem' }} />
                      )}
                      {FORMA_LABEL[conta.forma_pagamento] || '—'}
                    </span>
                  </div>
                  <div className="cupom-direita">
                    <span className={`cupom-status ${st.classe}`}>{st.texto}</span>
                    <span className="cupom-total">R$ {conta.valor_total.toFixed(2)}</span>
                  </div>
                </div>

                {conta.itens?.length > 0 && (
                  <div className="cupom-itens">
                    <div className="itens-header label-mono">
                      <span>Produto</span>
                      <span style={{ textAlign:'right' }}>Qtd</span>
                      <span style={{ textAlign:'right' }}>Unit.</span>
                      <span style={{ textAlign:'right' }}>Total</span>
                    </div>
                    {conta.itens.map(item => (
                      <div key={item.id} className="item-row">
                        <span className="item-desc">{item.descricao}</span>
                        <span className="item-qtd">{item.quantidade} {item.unidade}</span>
                        <span className="item-vunit">R$ {item.valor_unitario.toFixed(2)}</span>
                        <span className="item-vtotal">R$ {item.valor_total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </main>
    </div>
  )
}
