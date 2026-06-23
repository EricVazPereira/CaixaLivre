import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import { registrarCancelamento, cancelarItem as cancelarItemAPI, verificarPermissao } from '../services/api'
import './AutorizacaoPage.css'

const sentenceCase = s => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s

const ACAO_INFO = {
  'cancelar-item':  { titulo: 'Cancelar item',   desc: 'Autorize a remoção do item selecionado.',        icone: 'tabler:trash',         funcao: 'CANCEL_ITEM_CX_FUN',  voltar: '/operacao' },
  'cancelar-conta': { titulo: 'Cancelar conta',  desc: '',                                               icone: 'tabler:circle-x',      funcao: 'CANCEL_CONTA_CX_FUN', voltar: '/operacao' },
  'fechar':         { titulo: 'Fechar Caixa',    desc: '',                                               icone: 'tabler:cash-register', funcao: 'OPERA_CX_FUN',        voltar: '/inicio'   },
  'sair':           { titulo: 'Sair do Sistema', desc: '',                                               icone: 'tabler:logout',        funcao: 'OPERA_CX_FUN',        voltar: '/inicio'   },
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

  // fechar e sair usam campo único sequencial (Código → Senha)
  const sequencial = acao === 'fechar' || acao === 'sair' || acao === 'cancelar-conta' || acao === 'cancelar-item'

  // ── Leitor de código de barras ─────────────────────────────────────────────
  // Formato do barcode de permissão: {codigo}|{senha}[|]   ex: "0|794613|"
  // Leitores com layout US-QWERTY enviam '}' no lugar de '|' → normalizamos.
  // O scanner envia todos os caracteres em rafada e finaliza com Enter.
  const scanBuffer = useRef('')

  useEffect(() => {
    function onKeyDown(e) {
      if (confirmando) return

      if (e.key.length === 1) {
        scanBuffer.current += e.key
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const buf = scanBuffer.current
        scanBuffer.current = ''
        if (!buf) return

        // Normaliza separador US-layout (} → |) e tenta parsear como barcode de permissão
        const normalized = buf.replace(/}/g, '|')
        const m = normalized.match(/^([^|]+)\|([^|]+)\|?$/)

        if (m) {
          // Barcode completo: preenche código + senha e dispara confirmação
          const codVal   = m[1].slice(0, MAX)
          const senhaVal = m[2].slice(0, MAX)
          setCodigo(codVal)
          setSenha(senhaVal)
          setCampo('senha')
          // Pequeno delay para que os estados committem antes de confirmar
          setTimeout(() => handleConfirmarComValores(codVal, senhaVal), 50)
          return
        }

        // Não é barcode de permissão → trata como preenchimento manual do campo ativo
        if (campo === 'codigo') {
          setCodigo(buf.slice(0, MAX))
          if (sequencial) setCampo('senha')
        } else {
          setSenha(buf.slice(0, MAX))
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [campo, confirmando, sequencial])

  function pressKey(key) {
    if (campo === 'codigo') {
      if (key === '⌫') { setCodigo(c => c.slice(0, -1)); return }
      if (codigo.length >= MAX) return
      const novo = codigo + key
      setCodigo(novo)
      if (novo.length === MAX) setCampo('senha')
    } else {
      if (key === '⌫') setSenha(s => s.slice(0, -1))
      else if (senha.length < MAX) setSenha(s => s + key)
    }
  }

  const podeConfirmar = sequencial
    ? (campo === 'codigo' ? codigo.length > 0 : senha.length > 0)
    : (codigo.length > 0 && senha.length > 0)

  /** Executa a verificação de permissão e a ação. Aceita valores explícitos
   *  para permitir chamada via barcode (antes do estado React ser commitado). */
  async function handleConfirmarComValores(codVal, senhaVal) {
    if (!codVal || !senhaVal) { setErro('Preencha o código e a senha.'); return }
    setConfirmando(true)
    setErro('')
    try {
      const permissao = await verificarPermissao({ funcao: info.funcao, codigo: codVal, senha: senhaVal })
      if (!permissao.ok) {
        setErro(permissao.mensagem && /permiss|localiz|desabilit|usuário/i.test(permissao.mensagem)
          ? sentenceCase(permissao.mensagem)
          : 'Código ou senha inválidos.')
        setCodigo('')
        setSenha('')
        setCampo('codigo')
        setConfirmando(false)
        return
      }

      if (acao === 'fechar') { navigate('/fechar'); return }
      if (acao === 'sair')   { window.close(); return }
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
      setErro('Usuário não encontrado.')
      setConfirmando(false)
    }
  }

  async function handleConfirmar() {
    // Modo sequencial: Confirmar no passo do código avança para a senha
    if (sequencial && campo === 'codigo') {
      if (!codigo) { setErro('Digite o código.'); return }
      setErro('')
      setCampo('senha')
      return
    }
    await handleConfirmarComValores(codigo, senha)
  }

  function handleCancelar() {
    navigate(info.voltar)
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
        <p className="autorizacao-desc">
          {info.desc && <>{info.desc}<br /></>}
          {sequencial
            ? (campo === 'codigo' ? 'Digite o código do operador.' : 'Agora digite a senha.')
            : 'Um funcionário deve inserir seu código.'}
        </p>

        {/* Campos */}
        <div className="autorizacao-campos">
          {sequencial ? (
            /* Campo único — alterna Código → Senha */
            <button
              type="button"
              className="autorizacao-campo autorizacao-campo--ativo"
              disabled={confirmando}
            >
              <span
                key={campo}
                className={`autorizacao-campo-valor${(campo === 'codigo' ? codigo : senha).length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
              >
                {campo === 'codigo'
                  ? (codigo.length > 0 ? codigo : 'Código')
                  : (senha.length  > 0 ? '●'.repeat(senha.length) : 'Senha')}
              </span>
            </button>
          ) : (
            /* Dois campos simultâneos — cancelar item / cancelar conta */
            <>
              <button
                type="button"
                className="autorizacao-campo autorizacao-campo--ativo"
                onClick={() => setCampo('codigo')}
                disabled={confirmando}
              >
                <span
                  key={`codigo-${codigo.length === 0 ? 'empty' : 'filled'}`}
                  className={`autorizacao-campo-valor${codigo.length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
                >
                  {codigo.length > 0 ? codigo : 'Código'}
                </span>
              </button>

              <button
                type="button"
                className="autorizacao-campo autorizacao-campo--ativo"
                onClick={() => setCampo('senha')}
                disabled={confirmando}
              >
                <span
                  key={`senha-${senha.length === 0 ? 'empty' : 'filled'}`}
                  className={`autorizacao-campo-valor${senha.length > 0 ? ' autorizacao-campo-valor--preenchido' : ''}`}
                >
                  {senha.length > 0 ? '●'.repeat(senha.length) : 'Senha'}
                </span>
              </button>
            </>
          )}
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
