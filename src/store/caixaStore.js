import { create } from 'zustand'

export const useCaixaStore = create((set) => ({
  caixaAberto:  false,
  idHistorico:  null,
  nomeOperador: '',
  apelido:      '',
  cdOperador:   null,
  erpBarcode:   '',     // barcode retornado pelo GravaItens — identifica a comanda no ERP

  abrirCaixa: ({ idHistorico, nomeOperador, apelido, cdOperador }) =>
    set({ caixaAberto: true, idHistorico, nomeOperador, apelido, cdOperador, erpBarcode: '' }),

  setErpBarcode: (barcode) => set({ erpBarcode: barcode }),

  fecharCaixa: () =>
    set({ caixaAberto: false, idHistorico: null, nomeOperador: '', apelido: '', cdOperador: null, erpBarcode: '' }),
}))
