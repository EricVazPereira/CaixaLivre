import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCarrinhoStore } from '../store/carrinhoStore'
import { useCaixaStore } from '../store/caixaStore'
import { fecharComanda, imprimirCupom, realizarPagamentoCartao, buscarConfig } from '../services/api'
import './PagamentoPage.css'

const FORMAS = [
  { id: 'credito', nome: 'Cartão de Crédito', sub: 'Débito na fatura',      icon: 'tabler:credit-card' },
  { id: 'debito',  nome: 'Cartão de Débito',  sub: 'Débito imediato',       icon: 'tabler:credit-card-pay' },
  { id: 'pix',     nome: 'Pix',               sub: 'Pagamento instantâneo', icon: 'tabler:qrcode' },
]

/** Tenta detectar crédito/débito a partir do nomeProduto retornado pelo SiTef */
function formaFromSitef(resultado) {
  const nome = (resultado?.nomeProduto || '').toLowerCase()
  if (nome.includes('debito') || nome.includes('débit')) return 'debito'
  return 'credito'
}

export default function PagamentoPage() {
  const navigate = useNavigate()

  // ── Config ────────────────────────────────────────────────────────────────
  const [sitefHabilitado, setSitefHabilitado] = useState(null) // null = carregando

  useEffect(() => {
    buscarConfig().then(cfg => setSitefHabilitado(cfg.sitefHabilitado === true))
  }, [])

  // ── Estado do pagamento ───────────────────────────────────────────────────
  const [formaSelecionada, setFormaSelecionada] = useState(null)
  const [erro, setErro]               = useState('')
  const [processando, setProcessando] = useState(false)

  // 'idle' | 'aguardando_cartao' | 'fechando' | 'negado'
  const [sitefEtapa, setSitefEtapa] = useState('idle')
  const [sitefInfo, setSitefInfo]   = useState(null)

  const { itens, subtotal, cpf } = useCarrinhoStore()
  const { erpBarcode, setErpBarcode } = useCaixaStore()
  const total = subtotal()

  const isCartao = formaSelecionada === 'credito' || formaSelecionada === 'debito'

  // ── Finalização ERP (chamada após SiTef aprovado ou PIX/cartão sem SiTef) ─
  async function finalizarVenda(sitefResult = null, forma = formaSelecionada) {
    setSitefEtapa('fechando')
    setErro('')
    const subtotalVal = total.toFixed(2)
    try {
      const erpResult = await fecharComanda({
        subtotal: subtotalVal,
        total:    subtotalVal,
        barcode:  erpBarcode,
        forma_pagamento: forma,
        cpf: cpf ?? '',
      })
      setErpBarcode('')
      imprimirCupom({
        itens: itens.map(item => ({
          produto_codigo: item.codigo,
          descricao:      item.descricao,
          quantidade:     item.quantidade,
          valor_unitario: item.valor_unitario,
          unidade:        item.unidade || 'UN',
        })),
        total:           subtotalVal,
        forma_pagamento: forma,
        cpf:             cpf ?? '',
        chaveAcesso:     erpResult?.erp?.chave_acesso_comanda || '',
        protocolo:       erpResult?.erp?.nr_protocolo_nfce   || '',
        nfce:            erpResult?.erp?.nr_nfce             || '',
        urlQrcode:       erpResult?.erp?.url_qrcode          || '',
        sitefData: sitefResult ? {
          nomeProduto:    sitefResult.nomeProduto    || '',
          nsuHost:        sitefResult.nsuHost        || '',
          codAutorizacao: sitefResult.codAutorizacao || '',
          dataTx:         sitefResult.dataTx         || '',
          horaTx:         sitefResult.horaTx         || '',
          parcelasTx:     sitefResult.parcelasTx     || 1,
          valorTx:        sitefResult.valorTx        || '',
        } : null,
      })
      navigate('/impressao', { state: { total: subtotalVal, forma } })
    } catch (e) {
      setErro(e.message)
      setSitefEtapa('idle')
      setProcessando(false)
    }
  }

  // ── Fluxo SiTef ──────────────────────────────────────────────────────────
  async function executarSiTef() {
    setProcessando(true)
    setErro('')
    setSitefEtapa('aguardando_cartao')
    try {
      const idControle = Date.now()
      const docFiscal  = erpBarcode || idControle
      const resultado  = await realizarPagamentoCartao({ idControle, docFiscal, valor: total })

      if (!resultado.aprovado) {
        setSitefEtapa('negado')
        setSitefInfo(resultado)
        setProcessando(false)
        return
      }

      setSitefInfo(resultado)
      await finalizarVenda(resultado, formaFromSitef(resultado))
    } catch (e) {
      setErro(e.message)
      setSitefEtapa('idle')
      setProcessando(false)
    }
  }

  // ── Confirmar pagamento ───────────────────────────────────────────────────
  async function handleConfirmar() {
    if (sitefHabilitado) {
      // SiTef = Sim → direto para o SiTef, sem seleção de forma
      await executarSiTef()
      return
    }

    // SiTef = Não → fluxo normal
    if (!formaSelecionada) return
    setProcessando(true)
    setErro('')
    await finalizarVenda(null, formaSelecionada)
  }

  function handleTentarNovamente() {
    setSitefEtapa('idle')
    setSitefInfo(null)
    setErro('')
    setProcessando(false)
  }

  // ── Tela principal ────────────────────────────────────────────────────────
  const botaoDesabilitado = processando || (!sitefHabilitado && !formaSelecionada) || sitefHabilitado === null

  return (
    <div className="pagamento-root">
      {/* ── Overlay SiTef (aparece por cima quando sitefEtapa ≠ idle) ──────── */}
      {sitefEtapa !== 'idle' && (
        <div className="sitef-overlay">
          <div className="sitef-espera-card">
            {sitefEtapa === 'aguardando_cartao' && <>
              <iconify-icon icon="tabler:credit-card" class="sitef-espera-icon sitef-espera-icon-pulse" />
              <span className="sitef-espera-titulo">Aguardando pagamento</span>
              <span className="sitef-espera-sub">Aproxime, insira ou passe o cartão na maquininha</span>
              <div className="sitef-espera-valor">R$ {total.toFixed(2).replace('.', ',')}</div>
              <div className="sitef-espera-loader">
                <iconify-icon icon="tabler:loader-2" class="spin" style={{ fontSize: '1.4rem' }} />
                <span className="label-mono" style={{ fontSize: '1rem', opacity: 0.6 }}>Processando cartão…</span>
              </div>
            </>}

            {sitefEtapa === 'fechando' && <>
              <iconify-icon icon="tabler:circle-check" class="sitef-espera-icon" style={{ color: 'var(--color-green, #27ae60)' }} />
              <span className="sitef-espera-titulo">Pagamento aprovado!</span>
              <span className="sitef-espera-sub">Finalizando venda…</span>
              <div className="sitef-espera-loader">
                <iconify-icon icon="tabler:loader-2" class="spin" style={{ fontSize: '1.4rem' }} />
              </div>
            </>}

            {sitefEtapa === 'negado' && <>
              <iconify-icon icon="tabler:credit-card-off" class="sitef-espera-icon" style={{ color: '#e74c3c' }} />
              <span className="sitef-espera-titulo">Pagamento não aprovado</span>
              <span className="sitef-espera-sub">
                {sitefInfo?.nomeProduto
                  ? `Motivo: ${sitefInfo.nomeProduto}`
                  : 'Tente outro cartão ou forma de pagamento.'}
              </span>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}>
                <button className="btn-fenix" onClick={() => navigate('/operacao')}>
                  <iconify-icon icon="tabler:arrow-left" />
                  Cancelar
                </button>
                <button className="btn-fenix btn-green" onClick={handleTentarNovamente}>
                  <iconify-icon icon="tabler:refresh" />
                  Tentar novamente
                </button>
              </div>
            </>}
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="pagamento-header reveal d-1 active">
        <button className="btn-voltar" onClick={() => navigate('/operacao')} disabled={processando}>
          <iconify-icon icon="tabler:arrow-left" style={{ fontSize: '1rem' }} />
          Voltar
        </button>
        <div style={{ flex: 1 }} />
        <span className="pagamento-header-logo">Caixa<span>Livre</span></span>
        <span className="pagamento-header-sub label-mono">Finalizar Compra</span>
      </header>

      <main className="pagamento-main">
        {/* ── Resumo ────────────────────────────────────────────────────────── */}
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

        {/* ── Lado direito: forma + botão ───────────────────────────────────── */}
        <div className="forma-col reveal-blur d-3 active">

          {/* SiTef = Não → seleção de forma visível */}
          {sitefHabilitado === false && <>
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
          </>}

          {/* SiTef = Sim → instrução simples */}
          {sitefHabilitado === true && (
            <div className="sitef-modo-info">
              <iconify-icon icon="tabler:device-mobile-dollar" class="sitef-modo-icon" />
              <span className="sitef-modo-titulo">Pagamento via maquininha</span>
              <span className="sitef-modo-sub">
                Clique em Pagar — a maquininha vai solicitar o cartão do cliente.
              </span>
            </div>
          )}

          {/* Info e erros */}
          <div className="pagamento-info-wrap">
            {sitefHabilitado === false && formaSelecionada === 'pix' && (
              <div className="info-pagamento reveal active">
                <iconify-icon icon="tabler:qrcode" />
                <span>Escaneie o QR Code gerado na máquina de pagamento</span>
              </div>
            )}
            {sitefHabilitado === false && isCartao && (
              <div className="info-pagamento reveal active">
                <iconify-icon icon="tabler:credit-card-pay" />
                <span>Ao confirmar, aproxime ou insira seu cartão na maquininha</span>
              </div>
            )}
            {erro && (
              <div className="pagamento-erro reveal active">
                <iconify-icon icon="tabler:alert-triangle" style={{ fontSize: '1.1rem', flexShrink: 0 }} />
                {erro}
              </div>
            )}
          </div>

          {/* Botão confirmar */}
          <div className="pagamento-confirmar-wrap">
            <button
              className="btn-fenix btn-green btn-confirmar"
              onClick={handleConfirmar}
              disabled={botaoDesabilitado}
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
