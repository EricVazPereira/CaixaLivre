import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import './ImpressaoCupomPage.css'

const FORMA_LABEL = { credito: 'Cartão de Crédito', debito: 'Cartão de Débito', pix: 'Pix' }
const FORMA_ICON  = { credito: 'tabler:credit-card', debito: 'tabler:credit-card-pay', pix: 'tabler:qrcode' }
const TOTAL_SECONDS = 5

export default function ImpressaoCupomPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { cancelarConta } = useCarrinhoStore()
  const { total = 0, forma = '' } = location.state ?? {}

  const [segundos, setSegundos] = useState(TOTAL_SECONDS)

  const irParaInicio = useCallback(() => {
    cancelarConta()
    navigate('/inicio')
  }, [cancelarConta, navigate])

  useEffect(() => {
    const t = setInterval(() => {
      setSegundos(s => {
        if (s <= 1) { clearInterval(t); irParaInicio(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [irParaInicio])

  const progresso = (segundos / TOTAL_SECONDS) * 100

  return (
    <div className="impressao-root">
      <div className="impressao-orb impressao-orb-1" />
      <div className="impressao-orb impressao-orb-2" />
      <div className="impressao-card reveal-blur active">
        <div className="impressao-icon-wrap">
          <iconify-icon icon="tabler:printer" />
        </div>

        <h2 className="impressao-titulo reveal d-1 active">Compra finalizada!</h2>

        <span className="impressao-valor reveal d-2 active">R$ {Number(total).toFixed(2)}</span>

        {forma && (
          <div className="impressao-forma reveal d-2 active">
            <iconify-icon icon={FORMA_ICON[forma] ?? 'tabler:credit-card'} style={{ fontSize: '1.1rem' }} />
            {FORMA_LABEL[forma] ?? forma}
          </div>
        )}

        <p className="impressao-instrucao label-mono reveal d-3 active">
          Retire seu comprovante na impressora
        </p>

        <div className="impressao-countdown-track">
          <div className="impressao-countdown-bar" style={{ width: `${progresso}%` }} />
        </div>
        <span className="impressao-countdown-txt label-mono">
          Reiniciando em {segundos}s…
        </span>

        <button
          className="btn-fenix btn-dark"
          onClick={irParaInicio}
          style={{ height: '72px', fontSize: '0.825rem', borderRadius: '14px' }}
        >
          <iconify-icon icon="tabler:home" style={{ fontSize: '1.4rem' }} />
          Nova compra
        </button>
      </div>
    </div>
  )
}
