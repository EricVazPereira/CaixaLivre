import { useNavigate } from 'react-router-dom'
import IconCaixaRegistradora from '../components/IconCaixaRegistradora'
import './TotemInicioPage.css'

export default function TotemInicioPage() {
  const navigate = useNavigate()

  return (
    <div className="inicio-root" onClick={() => navigate('/cpf')}>
      <div className="inicio-orb inicio-orb-1" />
      <div className="inicio-orb inicio-orb-2" />
      <div className="inicio-orb inicio-orb-3" />

      <div className="inicio-btns-admin">
        <button
          className="inicio-btn-fechar"
          onClick={e => { e.stopPropagation(); navigate('/confirmar-gerente?acao=fechar') }}
          title="Fechar Caixa"
          aria-label="Fechar Caixa"
        >
          <IconCaixaRegistradora size="1.4rem" />
        </button>

        <button
          className="inicio-btn-fechar inicio-btn-sair"
          onClick={e => { e.stopPropagation(); navigate('/confirmar-gerente?acao=sair') }}
          title="Sair"
          aria-label="Sair do sistema"
        >
          <iconify-icon icon="tabler:logout" />
        </button>
      </div>

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
