import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import { registrarCancelamento } from '../services/api'
import './AutorizacaoPage.css'

const ACAO_INFO = {
  'cancelar-item':  { titulo: 'Cancelar item', desc: 'Autorize a remoção do item selecionado.', icone: 'tabler:trash' },
  'cancelar-conta': { titulo: 'Cancelar conta', desc: 'Autorize o cancelamento completo da compra.', icone: 'tabler:circle-x' },
}

export default function AutorizacaoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const acao = searchParams.get('acao') ?? 'cancelar-item'
  const info = ACAO_INFO[acao] ?? ACAO_INFO['cancelar-item']

  const [pin, setPin] = useState('')
  const [erro, setErro] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const { itens, cancelarItemSelecionado, cancelarConta } = useCarrinhoStore()
  const { setErpBarcode } = useCaixaStore()

  const PIN_MAX = 6
  const KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫']

  function pressKey(key) {
    if (key === '⌫') setPin(p => p.slice(0, -1))
    else if (pin.length < PIN_MAX) setPin(p => p + key)
  }

  async function handleConfirmar() {
    if (!pin) { setErro('Digite o código do funcionário.'); return }
    setConfirmando(true)
    setErro('')
    try {
      if (acao === 'cancelar-conta') {
        if (itens.length > 0) await registrarCancelamento(itens)
        cancelarConta()
        setErpBarcode('')
      } else {
        cancelarItemSelecionado()
      }
      navigate('/operacao')
    } catch {
      setErro('Erro ao processar. Tente novamente.')
      setConfirmando(false)
    }
  }

  function handleCancelar() {
    navigate('/operacao')
  }

  return (
    <div className="autorizacao-root">
      <div className="autorizacao-orb autorizacao-orb-1" />
      <div className="autorizacao-orb autorizacao-orb-2" />
      <div className="autorizacao-card reveal-blur active">
        <div className="autorizacao-icon-wrap">
          <iconify-icon icon={info.icone} />
        </div>
        <h1 className="autorizacao-title">{info.titulo}</h1>
        <p className="autorizacao-desc">{info.desc}<br />Um funcionário deve inserir seu código.</p>

        {/* PIN dots */}
        <div className="autorizacao-pin-display">
          {Array.from({ length: PIN_MAX }).map((_, i) => (
            <div key={i} className={`autorizacao-pin-dot ${i < pin.length ? 'autorizacao-pin-dot--filled' : ''}`} />
          ))}
        </div>

        {/* Numpad */}
        <div className="numpad-grid autorizacao-numpad">
          {KEYS.map((key, i) => (
            key === '' ? <div key={i} /> :
            <button
              key={key+i}
              className={`numpad-key ${key === '⌫' ? 'numpad-key--del' : ''}`}
              onClick={() => pressKey(key)}
              type="button"
              disabled={confirmando}
            >
              {key === '⌫' ? <iconify-icon icon="tabler:backspace" /> : key}
            </button>
          ))}
        </div>

        {erro && (
          <div className="autorizacao-erro">
            <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '0.75rem', flexShrink: 0 }} />
            {erro}
          </div>
        )}

        <div className="autorizacao-btns">
          <button
            className="btn-fenix btn-dark"
            onClick={handleCancelar}
            disabled={confirmando}
            style={{ height: '72px', fontSize: '0.75rem', flex: 1, borderRadius: '14px' }}
          >
            <iconify-icon icon="tabler:arrow-left" />
            Cancelar
          </button>
          <button
            className="btn-fenix btn-orange"
            onClick={handleConfirmar}
            disabled={!pin || confirmando}
            style={{ height: '72px', fontSize: '0.75rem', flex: 2, borderRadius: '14px' }}
          >
            <iconify-icon icon="tabler:shield-check" />
            {confirmando ? 'Processando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
