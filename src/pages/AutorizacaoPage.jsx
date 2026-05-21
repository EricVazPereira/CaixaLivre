import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import { registrarCancelamento, cancelarItem as cancelarItemAPI, verificarPermissao } from '../services/api'
import './AutorizacaoPage.css'

const ACAO_INFO = {
  'cancelar-item':  { titulo: 'Cancelar item', desc: 'Autorize a remoção do item selecionado.', icone: 'tabler:trash',   funcao: 'CANCEL_CONTA_CX_FUN' },
  'cancelar-conta': { titulo: 'Cancelar conta', desc: 'Autorize o cancelamento completo da compra.', icone: 'tabler:circle-x', funcao: 'CANCEL_CONTA_CX_FUN' },
}

export default function AutorizacaoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const acao = searchParams.get('acao') ?? 'cancelar-item'
  const info = ACAO_INFO[acao] ?? ACAO_INFO['cancelar-item']

  const [codigo, setCodigo] = useState('')
  const [senha,  setSenha]  = useState('')
  const [campo,  setCampo]  = useState('codigo') // campo ativo no numpad
  const [erro,   setErro]   = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const { itens, itemSelecionado, cancelarItemSelecionado, cancelarConta } = useCarrinhoStore()
  const { erpBarcode, setErpBarcode } = useCaixaStore()

  const MAX = 6
  const KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫']

  function pressKey(key) {
    if (campo === 'codigo') {
      if (key === '⌫') { setCodigo(c => c.slice(0, -1)); return }
      if (codigo.length >= MAX) return
      const novo = codigo + key
      setCodigo(novo)
      if (novo.length === MAX) setCampo('senha') // avança ao preencher
    } else {
      if (key === '⌫') setSenha(s => s.slice(0, -1))
      else if (senha.length < MAX) setSenha(s => s + key)
    }
  }

  const podeConfirmar = codigo.length > 0 && senha.length > 0

  async function handleConfirmar() {
    if (!codigo || !senha) { setErro('Preencha o código e a senha.'); return }
    setConfirmando(true)
    setErro('')
    try {
      // 1. Verifica permissão no ERP
      const permissao = await verificarPermissao({ funcao: info.funcao, codigo, senha })
      if (!permissao.ok) {
        setErro(permissao.mensagem || 'Sem permissão para esta operação.')
        setSenha('')
        setCampo('senha')
        setConfirmando(false)
        return
      }

      // 2. Executa a ação autorizada
      if (acao === 'cancelar-conta') {
        if (itens.length > 0) await registrarCancelamento(itens)
        cancelarConta()
        setErpBarcode('')
      } else {
        const item = itens.find(i => i.id === itemSelecionado)
        if (item?.contador && erpBarcode) {
          await cancelarItemAPI({ nr_gerador: erpBarcode, ordem_item: item.contador })
        }
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

        {/* Campos código + senha */}
        <div className="autorizacao-campos">
          <button
            type="button"
            className={`autorizacao-campo ${campo === 'codigo' ? 'autorizacao-campo--ativo' : ''}`}
            onClick={() => setCampo('codigo')}
            disabled={confirmando}
          >
            <span className={`autorizacao-campo-valor${codigo.length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}>
              {codigo.length > 0 ? codigo : 'Código'}
            </span>
          </button>

          <button
            type="button"
            className={`autorizacao-campo ${campo === 'senha' ? 'autorizacao-campo--ativo' : ''}`}
            onClick={() => setCampo('senha')}
            disabled={confirmando}
          >
            <span className={`autorizacao-campo-valor${senha.length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}>
              {senha.length > 0 ? '●'.repeat(senha.length) : 'Senha'}
            </span>
          </button>
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
            <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1rem', flexShrink: 0 }} />
            {erro}
          </div>
        )}

        <div className="autorizacao-btns">
          <button
            className="btn-fenix btn-dark"
            onClick={handleCancelar}
            disabled={confirmando}
            style={{ height: '72px', fontSize: '1rem', flex: 1, borderRadius: '14px' }}
          >
            <iconify-icon icon="tabler:arrow-left" />
            Voltar
          </button>
          <button
            className="btn-fenix btn-orange"
            onClick={handleConfirmar}
            disabled={!podeConfirmar || confirmando}
            style={{ height: '72px', fontSize: '1rem', flex: 2, borderRadius: '14px' }}
          >
            <iconify-icon icon="tabler:shield-check" />
            {confirmando ? 'Processando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
