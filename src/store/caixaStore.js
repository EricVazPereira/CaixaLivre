import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useCaixaStore = create(
  persist(
    (set, get) => ({
      caixaAberto:  false,
      idHistorico:  null,
      nomeOperador: '',
      apelido:      '',
      cdOperador:   null,
      erpBarcode:      '',  // barcode retornado pelo GravaItens — identifica a comanda no ERP
      erpItemContador: 0,   // contador sequencial de itens adicionados à conta atual
      nmEstacao:       '',
      dataAbertura:    null,  // ISO string do momento em que o caixa foi aberto

      abrirCaixa: ({ idHistorico, nomeOperador, apelido, cdOperador, nmEstacao = '' }) =>
        set({ caixaAberto: true, idHistorico, nomeOperador, apelido, cdOperador, erpBarcode: '', erpItemContador: 0, nmEstacao, dataAbertura: new Date().toISOString() }),

      setErpBarcode: (barcode) => set({ erpBarcode: barcode }),

      /** Incrementa e retorna o próximo contador de item no formato "0001", "0002"… */
      nextItemContador: () => {
        const next = (get().erpItemContador || 0) + 1
        set({ erpItemContador: next })
        return String(next).padStart(4, '0')
      },

      fecharCaixa: () =>
        set({ caixaAberto: false, idHistorico: null, nomeOperador: '', apelido: '', cdOperador: null, erpBarcode: '', erpItemContador: 0, nmEstacao: '', dataAbertura: null }),
    }),
    { name: 'caixa-store' }
  )
)
