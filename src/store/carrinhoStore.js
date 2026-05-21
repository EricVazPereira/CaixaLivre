import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useCarrinhoStore = create(
  persist(
  (set, get) => ({
  itens: [],
  itemSelecionado: null,  // id único da linha selecionada
  cpf: '',

  setCpf: (cpf) => set({ cpf }),

  /** Cada scan cria uma linha nova — sem agrupamento por código.
   *  Se produto.id já vier preenchido, usa ele (permite rastrear o item externamente). */
  adicionarItem(produto, quantidade = 1) {
    const qtd = Number(quantidade)
    const novoItem = {
      ...produto,
      id:         produto.id || crypto.randomUUID(),
      // Inteiros: garante mínimo 1. Decimais (ex: 0,042 kg): preserva como veio.
      quantidade: Number.isInteger(qtd) ? Math.max(1, qtd) : Math.max(0.001, qtd),
    }
    set(state => ({ itens: [...state.itens, novoItem] }))
  },

  selecionarItem(id) {
    set({ itemSelecionado: id })
  },

  /** Remove apenas a linha com o id selecionado */
  cancelarItemSelecionado() {
    const { itemSelecionado } = get()
    if (!itemSelecionado) return
    set(state => ({
      itens: state.itens.filter(i => i.id !== itemSelecionado),
      itemSelecionado: null,
    }))
  },

  /** Atualiza o peso_gramas de um item já no carrinho (aprendizado pós-scan) */
  atualizarPesoItem(id, pesoGramas) {
    set(state => ({
      itens: state.itens.map(it =>
        it.id === id ? { ...it, peso_gramas: pesoGramas } : it
      ),
    }))
  },

  cancelarConta() {
    set({ itens: [], itemSelecionado: null, cpf: '' })
  },

  subtotal() {
    return get().itens.reduce((acc, i) => acc + i.valor_unitario * i.quantidade, 0)
  },
  }),
  {
    name: 'carrinho-store',
    // itemSelecionado não persiste — sempre começa sem seleção
    partialize: (state) => ({ itens: state.itens, cpf: state.cpf }),
  }
))
