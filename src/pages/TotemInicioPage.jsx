import { useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import './TotemInicioPage.css'

export default function TotemInicioPage() {
  const navigate = useNavigate()
  const [adminVisible, setAdminVisible] = useState(false)
  const pressTimer = useRef(null)
  const hideTimer = useRef(null)

  // Auto-hide admin panel after 4s de inatividade
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

  const handleRootClick = () => {
    if (adminVisible) {
      setAdminVisible(false)
    } else {
      navigate('/cpf')
    }
  }

  return (
    <div className="inicio-root" onClick={handleRootClick}>

      <div className="inicio-orb inicio-orb-1" />
      <div className="inicio-orb inicio-orb-2" />
      <div className="inicio-orb inicio-orb-3" />

      {/* Gatilho invisível no canto superior direito — segure 1,5s para admin */}
      <div
        className="inicio-admin-trigger"
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
        onClick={e => e.stopPropagation()}
      />

      <div className="inicio-content">
        <div className="inicio-logo-mark">
          <img src="/caixalivre-icon.svg" alt="CaixaLivre" className="inicio-logo-svg" />
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

      {adminVisible && (
        <div className="inicio-admin-panel" onClick={e => e.stopPropagation()}>
          <p className="inicio-admin-hint">Acesso restrito</p>
          <button
            className="inicio-admin-btn"
            onClick={() => navigate('/autorizacao?acao=fechar')}
          >
            <iconify-icon icon="tabler:cash-register" />
            Fechar Caixa
          </button>
          <button
            className="inicio-admin-btn"
            onClick={() => navigate('/autorizacao?acao=sair')}
          >
            <iconify-icon icon="tabler:logout" />
            Sair
          </button>
        </div>
      )}
    </div>
  )
}
