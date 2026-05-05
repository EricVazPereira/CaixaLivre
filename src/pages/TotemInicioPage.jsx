import { useNavigate } from 'react-router-dom'
import './TotemInicioPage.css'

export default function TotemInicioPage() {
  const navigate = useNavigate()
  return (
    <div className="inicio-root" onClick={() => navigate('/cpf')}>
      <div className="inicio-orb inicio-orb-1" />
      <div className="inicio-orb inicio-orb-2" />
      <div className="inicio-orb inicio-orb-3" />

      <button
        className="inicio-btn-fechar"
        onClick={e => { e.stopPropagation(); navigate('/fechar') }}
        title="Fechar Caixa"
      >
        <iconify-icon icon="tabler:lock" />
      </button>

      <div className="inicio-content">
        <div className="inicio-logo-mark">
          <iconify-icon icon="tabler:device-tablet" />
        </div>
        <h1 className="inicio-logo-text">Caixa<span>Livre</span></h1>
        <p className="inicio-sub label-mono">Autoatendimento</p>
        <div className="inicio-separator" />
        <div className="inicio-cta-wrap">
          <div className="inicio-hand-wrap">
            <iconify-icon icon="tabler:hand-finger" />
          </div>
          <p className="inicio-toque-text">Toque para iniciar</p>
        </div>
      </div>
      <p className="inicio-footer label-mono">Sistema Fênix · CaixaLivre</p>
    </div>
  )
}
