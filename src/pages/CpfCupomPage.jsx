import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import './CpfCupomPage.css'

function validarCpf(digits) {
  if (digits.length !== 11) return false
  // Rejeita sequências iguais (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(digits)) return false
  const d = digits.split('').map(Number)
  // Primeiro dígito verificador
  const r1 = d.slice(0,9).reduce((sum, n, i) => sum + n * (10 - i), 0) % 11
  if (d[9] !== (r1 < 2 ? 0 : 11 - r1)) return false
  // Segundo dígito verificador
  const r2 = d.slice(0,10).reduce((sum, n, i) => sum + n * (11 - i), 0) % 11
  if (d[10] !== (r2 < 2 ? 0 : 11 - r2)) return false
  return true
}

export default function CpfCupomPage() {
  const navigate = useNavigate()
  const { setCpf } = useCarrinhoStore()
  const [modo, setModo] = useState('escolha') // 'escolha' | 'digitar'
  const [digits, setDigits] = useState('')
  const [erro, setErro] = useState('')

  function handleSemCpf() {
    setCpf('')
    navigate('/operacao')
  }

  function handleConfirmarCpf() {
    if (!validarCpf(digits)) {
      setErro('CPF inválido. Verifique os números e tente novamente.')
      return
    }
    setCpf(digits)
    navigate('/operacao')
  }

  function pressKey(key) {
    setErro('')
    if (key === '⌫') setDigits(d => d.slice(0, -1))
    else if (digits.length < 11) setDigits(d => d + key)
  }

  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  if (modo === 'digitar') {
    const raw = digits + '_'.repeat(Math.max(0, 11 - digits.length))
    const formatted = `${raw.slice(0,3)}.${raw.slice(3,6)}.${raw.slice(6,9)}-${raw.slice(9,11)}`

    return (
      <div className="cpf-root">
        <div className="cpf-orb cpf-orb-1" />
        <div className="cpf-orb cpf-orb-2" />
        <div className="cpf-card reveal-blur active">
          <div className="cpf-icon-wrap">
            <iconify-icon icon="tabler:id" />
          </div>
          <h1 className="cpf-title">Digite seu CPF</h1>
          <div className={`cpf-display-formatted ${digits.length > 0 ? 'cpf-display--active' : ''}`}>
            {formatted}
          </div>
          <div className="numpad-grid">
            {KEYS.map((key, i) => (
              key === '' ? <div key={i} /> :
              <button
                key={key+i}
                className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                onClick={() => pressKey(key)}
                type="button"
              >
                {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
              </button>
            ))}
          </div>
          {erro && (
            <div className="cpf-erro">
              <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '0.75rem', flexShrink: 0 }} />
              {erro}
            </div>
          )}

          <div className="cpf-btns-bottom">
            <button
              className="btn-fenix btn-dark"
              onClick={() => { setDigits(''); setErro(''); setModo('escolha') }}
              style={{ height: '64px', fontSize: '0.75rem', flex: 1 }}
            >
              <iconify-icon icon="tabler:arrow-left" />
              Voltar
            </button>
            <button
              className="btn-fenix btn-blue"
              onClick={handleConfirmarCpf}
              disabled={digits.length !== 11}
              style={{ height: '64px', fontSize: '0.75rem', flex: 2 }}
            >
              <iconify-icon icon="tabler:check" />
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="cpf-root">
      <div className="cpf-orb cpf-orb-1" />
      <div className="cpf-orb cpf-orb-2" />
      <div className="cpf-card reveal-blur active">
        <div className="cpf-icon-wrap">
          <iconify-icon icon="tabler:receipt" />
        </div>
        <h1 className="cpf-title">CPF no cupom?</h1>
        <div className="cpf-btns">
          <button
            className="btn-fenix btn-dark"
            onClick={handleSemCpf}
            style={{ height: '80px', fontSize: '0.9rem', borderRadius: '16px' }}
          >
            <iconify-icon icon="tabler:x" style={{ fontSize: '1.5rem' }} />
            Não, continuar
          </button>
          <button
            className="btn-fenix btn-blue"
            onClick={() => setModo('digitar')}
            style={{ height: '80px', fontSize: '0.9rem', borderRadius: '16px' }}
          >
            <iconify-icon icon="tabler:id" style={{ fontSize: '1.5rem' }} />
            Sim, informar CPF
          </button>
        </div>
      </div>
    </div>
  )
}
