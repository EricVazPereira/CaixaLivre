import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import './CpfCupomPage.css'

// ── Validações ────────────────────────────────────────────────────────────────

function validarCpf(d) {
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false
  const n = d.split('').map(Number)
  const r1 = n.slice(0, 9).reduce((s, v, i) => s + v * (10 - i), 0) % 11
  if (n[9] !== (r1 < 2 ? 0 : 11 - r1)) return false
  const r2 = n.slice(0, 10).reduce((s, v, i) => s + v * (11 - i), 0) % 11
  return n[10] === (r2 < 2 ? 0 : 11 - r2)
}

function validarCnpj(d) {
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false
  const calc = (str, len) => {
    let sum = 0, pos = len - 7
    for (let i = len; i >= 1; i--) {
      sum += Number(str[len - i]) * pos--
      if (pos < 2) pos = 9
    }
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(d, 12) === Number(d[12]) && calc(d, 13) === Number(d[13])
}

// ── Formatação dinâmica ───────────────────────────────────────────────────────

function formatarDocumento(digits) {
  if (digits.length <= 11) {
    // CPF: XXX.XXX.XXX-XX — preenche da direita para a esquerda
    const s = ('_'.repeat(11) + digits).slice(-11)
    return `${s[0]}${s[1]}${s[2]}.${s[3]}${s[4]}${s[5]}.${s[6]}${s[7]}${s[8]}-${s[9]}${s[10]}`
  }
  // CNPJ: XX.XXX.XXX/XXXX-XX — preenche da direita para a esquerda
  const s = ('_'.repeat(14) + digits).slice(-14)
  return `${s[0]}${s[1]}.${s[2]}${s[3]}${s[4]}.${s[5]}${s[6]}${s[7]}/${s[8]}${s[9]}${s[10]}${s[11]}-${s[12]}${s[13]}`
}

function tipoDocumento(digits) {
  return digits.length <= 11 ? 'CPF' : 'CNPJ'
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function CpfCupomPage() {
  const navigate = useNavigate()
  const { setCpf } = useCarrinhoStore()
  const [modo, setModo] = useState('escolha') // 'escolha' | 'digitar'
  const [digits, setDigits] = useState('')

  function handleSemCpf() {
    setCpf('')
    navigate('/operacao')
  }

  function handleConfirmar() {
    setCpf(digits)
    navigate('/operacao')
  }

  function pressKey(key) {
    if (key === '⌫') {
      setDigits(d => d.slice(0, -1))
    } else if (digits.length < 14) {
      setDigits(d => d + key)
    }
  }

  const KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫']

  const comprimentoCompleto = digits.length === 11 || digits.length === 14
  const isValido  = (digits.length === 11 && validarCpf(digits)) || (digits.length === 14 && validarCnpj(digits))
  const invalido  = comprimentoCompleto && !isValido   // detectado automaticamente
  const podeConfirmar = isValido                        // botão só ativa se realmente válido
  const tipo = tipoDocumento(digits)

  if (modo === 'digitar') {
    return (
      <div className="cpf-root">
        <div className="cpf-orb cpf-orb-1" />
        <div className="cpf-orb cpf-orb-2" />
        <div className="cpf-card reveal-blur active">
          <div className="cpf-icon-wrap">
            <iconify-icon icon="tabler:id" />
          </div>
          <h1 className="cpf-title">Digite seu CPF ou CNPJ</h1>
          <p className={`cpf-desc${invalido ? ' cpf-desc--erro' : ''}`}>
            {invalido
              ? 'CPF errado. Confira e tente de novo.'
              : digits.length < 11
                ? 'CPF tem 11 dígitos · CNPJ tem 14'
                : digits.length === 11
                  ? 'CPF ok — é CNPJ? Continue digitando'
                  : `Faltam ${14 - digits.length} dígitos`}
          </p>

          <div className="cpf-display-wrapper">
            <div className={`cpf-display-formatted ${digits.length > 0 ? 'cpf-display--active' : ''} ${isValido ? 'cpf-display--valido' : ''} ${invalido ? 'cpf-display--invalido' : ''}`}>
              {formatarDocumento(digits)}
            </div>
            {isValido && !invalido && (
              <iconify-icon icon="tabler:circle-check-filled" class="cpf-check-icon" />
            )}
            {invalido && (
              <iconify-icon icon="tabler:circle-x-filled" class="cpf-check-icon cpf-x-icon" />
            )}
          </div>

          <div className="numpad-grid">
            {KEYS.map((key, i) => (
              key === '' ? <div key={i} /> :
              <button
                key={key + i}
                className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
                onClick={() => pressKey(key)}
                type="button"
              >
                {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
              </button>
            ))}
          </div>

          <div className="cpf-btns-bottom">
            <button
              className="btn-fenix btn-dark"
              onClick={() => { setDigits(''); setModo('escolha') }}
              style={{ height: '64px', fontSize: '1rem', flex: 1 }}
            >
              <iconify-icon icon="tabler:arrow-left" />
              Voltar
            </button>
            <button
              className="btn-fenix btn-blue"
              onClick={handleConfirmar}
              disabled={!podeConfirmar}
              style={{ height: '64px', fontSize: '1rem', flex: 2 }}
            >
              <iconify-icon icon="tabler:check" />
              Confirmar {podeConfirmar ? tipo : ''}
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
        <button
          className="cpf-btn-voltar"
          onClick={() => navigate(-1)}
          aria-label="Voltar"
        >
          <iconify-icon icon="tabler:arrow-left" />
        </button>
        <div className="cpf-icon-wrap">
          <iconify-icon icon="tabler:receipt" />
        </div>
        <h1 className="cpf-title">CPF ou CNPJ na nota?</h1>
        <p className="cpf-desc">Sua nota fica disponível para o imposto de renda</p>
        <div className="cpf-btns">
          <button
            className="btn-fenix btn-dark"
            onClick={handleSemCpf}
            style={{ height: '80px', borderRadius: '16px' }}
          >
            <iconify-icon icon="tabler:x" style={{ fontSize: '1.5rem' }} />
            Pular
          </button>
          <button
            className="btn-fenix btn-blue"
            onClick={() => setModo('digitar')}
            style={{ height: '80px', borderRadius: '16px' }}
          >
            <iconify-icon icon="tabler:id" style={{ fontSize: '1.5rem' }} />
            Sim, quero informar
          </button>
        </div>
      </div>
    </div>
  )
}
