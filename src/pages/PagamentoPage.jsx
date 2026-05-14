import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import { fecharComanda, imprimirCupom } from '../services/api'
import './PagamentoPage.css'

const FORMAS = [
  { id: 'credito', nome: 'Cartão de Crédito', sub: 'Débito na fatura',      icon: 'tabler:credit-card' },
  { id: 'debito',  nome: 'Cartão de Débito',  sub: 'Débito imediato',       icon: 'tabler:credit-card-pay' },
  { id: 'pix',     nome: 'Pix',               sub: 'Pagamento instantâneo', icon: 'tabler:qrcode' },
]

export default function PagamentoPage() {
  const navigate = useNavigate()
  const [formaSelecionada, setFormaSelecionada] = useState(null)
  const [erro, setErro]               = useState('')
  const [processando, setProcessando] = useState(false)

  const { itens, subtotal, cpf } = useCarrinhoStore()
  const { erpBarcode, setErpBarcode } = useCaixaStore()
  const total = subtotal()

  async function handleConfirmar() {
    if (!formaSelecionada) return
    setProcessando(true)
    setErro('')
    try {
      const subtotalVal = total.toFixed(2)
      const erpResult = await fecharComanda({ subtotal: subtotalVal, total: subtotalVal, barcode: erpBarcode, forma_pagamento: formaSelecionada, cpf: cpf ?? '' })
      setErpBarcode('')
      imprimirCupom({  // fire-and-forget — não bloqueia a navegação
        itens: itens.map(item => ({
          produto_codigo: item.codigo,
          descricao:      item.descricao,
          quantidade:     item.quantidade,
          valor_unitario: item.valor_unitario,
          unidade:        item.unidade || 'UN',
        })),
        total:           subtotalVal,
        forma_pagamento: formaSelecionada,
        cpf:             cpf ?? '',
        chaveAcesso:     erpResult?.erp?.chave_acesso_comanda || '',
        protocolo:       erpResult?.erp?.nr_protocolo_nfce   || '',
        nfce:            erpResult?.erp?.nr_nfce             || '',
        urlQrcode:       erpResult?.erp?.url_qrcode          || '',
      })
      navigate('/impressao', { state: { total: subtotalVal, forma: formaSelecionada } })
    } catch (e) {
      setErro(e.message)
      setProcessando(false)
    }
  }

  return (
    <div className="pagamento-root">
      <header className="pagamento-header reveal d-1 active">
        <button className="btn-voltar" onClick={() => navigate('/operacao')}>
          <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1rem' }} />
          Voltar
        </button>
        <div style={{ flex: 1 }} />
        <span className="pagamento-header-logo">Caixa<span>Livre</span></span>
        <span className="pagamento-header-sub label-mono">Finalizar Compra</span>
      </header>

      <main className="pagamento-main">
        {/* Resumo */}
        <div className="resumo-col reveal-blur d-2 active">
          <div className="resumo-header-row">
            <span>Produto</span>
            <span style={{ textAlign: 'right' }}>Qtd</span>
            <span style={{ textAlign: 'right' }}>Unit.</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>
          <div className="resumo-itens">
            {itens.map((item, index) => (
              <div
                key={item.codigo}
                className="resumo-item"
                style={{ animationDelay: `${index * 0.04}s` }}
              >
                <span className="resumo-item-nome">{item.descricao}</span>
                <span className="resumo-item-qtd">{item.quantidade} {item.unidade}</span>
                <span className="resumo-item-preco">R$ {item.valor_unitario.toFixed(2)}</span>
                <span className="resumo-item-valor">R$ {(item.valor_unitario * item.quantidade).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="resumo-total-bar">
            <span className="resumo-total-label label-mono">Total da compra</span>
            <span className="resumo-total-valor">R$ {total.toFixed(2)}</span>
          </div>
        </div>

        {/* Formas */}
        <div className="forma-col reveal-blur d-3 active">
          <span className="forma-title label-mono">
            <iconify-icon icon="tabler:wallet" style={{ fontSize: '1.1rem', marginRight: '0.4rem' }} />
            Forma de pagamento
          </span>

          {FORMAS.map(forma => (
            <button
              key={forma.id}
              className={`forma-btn ${formaSelecionada === forma.id ? 'forma-selecionada' : ''}`}
              onClick={() => setFormaSelecionada(forma.id)}
              disabled={processando}
              aria-pressed={formaSelecionada === forma.id}
            >
              <div className="forma-btn-icon">
                <iconify-icon icon={forma.icon} style={{ fontSize: '1.5rem' }} />
              </div>
              <div className="forma-btn-texto">
                <span className="forma-btn-nome">{forma.nome}</span>
                <span className="forma-btn-sub">{forma.sub}</span>
              </div>
              {formaSelecionada === forma.id && (
                <div className="forma-btn-check">
                  <iconify-icon icon="tabler:check" style={{ fontSize: '1rem' }} />
                </div>
              )}
            </button>
          ))}

          <div className="pagamento-info-wrap">
            {formaSelecionada === 'pix' && (
              <div className="info-pagamento reveal active">
                <iconify-icon icon="tabler:qrcode" />
                <span>Escaneie o QR Code gerado na máquina de pagamento</span>
              </div>
            )}
            {(formaSelecionada === 'credito' || formaSelecionada === 'debito') && (
              <div className="info-pagamento reveal active">
                <iconify-icon icon="tabler:credit-card-pay" />
                <span>Aproxime ou insira seu cartão na máquina</span>
              </div>
            )}
            {erro && (
              <div className="pagamento-erro reveal active">
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
                {erro}
              </div>
            )}
          </div>

          <div className="pagamento-confirmar-wrap">
            <button
              className="btn-fenix btn-green btn-confirmar"
              onClick={handleConfirmar}
              disabled={!formaSelecionada || processando}
              aria-busy={processando}
            >
              {processando
                ? <iconify-icon icon="tabler:loader-2" class="spin" />
                : <iconify-icon icon="tabler:circle-check" />
              }
              {processando ? 'Processando…' : `Pagar R$ ${total.toFixed(2).replace('.', ',')}`}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
