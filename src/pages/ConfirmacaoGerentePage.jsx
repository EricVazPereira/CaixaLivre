import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { verificarPermissao } from '../services/api'
import './ConfirmacaoGerentePage.css'

const MAX  = 6
const KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫']

export default function ConfirmacaoGerentePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const acao = searchParams.get('acao') ?? 'fechar'

  const [codigo,      setCodigo]      = useState('')
  const [erro,        setErro]        = useState('')
  const [confirmando, setConfirmando] = useState(false)

  function pressKey(key) {
    if (key === '⌫') { setCodigo(c => c.slice(0, -1)); return }
    if (codigo.length >= MAX) return
    setCodigo(c => c + key)
  }

  async function handleConfirmar() {
    if (!codigo) { setErro('Digite o código do operador.'); return }
    setConfirmando(true)
    setErro('')
    try {
      const permissao = await verificarPermissao({
        funcao: 'CANCEL_CONTA_CX_FUN',
        codigo,
        senha: codigo,
      })
      if (!permissao.ok) {
        setErro(permissao.mensagem || 'Código inválido.')
        setCodigo('')
        setConfirmando(false)
        return
      }
      if (acao === 'fechar') navigate('/fechar')
      else window.close()
    } catch {
      setErro('Erro ao verificar. Tente novamente.')
      setConfirmando(false)
    }
  }

  return (
    <div className="gerente-root">
      <div className="gerente-icon-wrap">
        <iconify-icon icon="tabler:shield-lock" />
      </div>

      <h1 className="gerente-titulo">Confirmação do gerente</h1>
      <p className="gerente-desc">Digite o código do operador.</p>

      {/* Campo único */}
      <div className={`gerente-campo ${codigo.length > 0 ? 'gerente-campo--preenchido' : ''}`}>
        <span className="gerente-campo-valor">
          {codigo.length > 0 ? '●'.repeat(codigo.length) : 'código'}
        </span>
      </div>

      {/* Numpad */}
      <div className="gerente-numpad">
        {KEYS.map((key, i) => (
          key === '' ? <div key={i} /> :
          <button
            key={key + i}
            className={`gerente-key ${key === '⌫' ? 'gerente-key--del' : ''}`}
            onClick={() => pressKey(key)}
            type="button"
            disabled={confirmando}
          >
            {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
          </button>
        ))}
      </div>

      {erro && (
        <div className="gerente-erro">
          <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
          {erro}
        </div>
      )}

      <div className="gerente-btns">
        <button
          className="btn-fenix btn-dark"
          onClick={() => navigate('/inicio')}
          disabled={confirmando}
          style={{ height: '72px', fontSize: '1rem', flex: 1, borderRadius: '14px' }}
        >
          <iconify-icon icon="tabler:arrow-left" />
          Voltar
        </button>
        <button
          className="btn-fenix btn-orange"
          onClick={handleConfirmar}
          disabled={!codigo || confirmando}
          style={{ height: '72px', fontSize: '1rem', flex: 2, borderRadius: '14px' }}
        >
          <iconify-icon icon="tabler:shield-check" />
          {confirmando ? 'Verificando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  )
}
