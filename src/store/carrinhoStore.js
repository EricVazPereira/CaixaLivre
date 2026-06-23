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
   *  Se produto.id já vier preenchido, usa ele (permite rastrear o item externamente).
   *  ordinal = número de ordem de passagem (1, 2, 3…), nunca muda após adição. */
  adicionarItem(produto, quantidade = 1) {
    const qtd = Number(quantidade)
    const novoItem = {
      ...produto,
      id:        produto.id || crypto.randomUUID(),
      ordinal:   get().itens.length + 1,
      cancelado: false,
      quantidade: Number.isInteger(qtd) ? Math.max(1, qtd) : Math.max(0.001, qtd),
    }
    set(state => ({ itens: [...state.itens, novoItem] }))
  },

  selecionarItem(id) {
    set({ itemSelecionado: id })
  },

  /** Marca o item selecionado como cancelado — mantém na lista com estilo vermelho */
  cancelarItemSelecionado() {
    const { itemSelecionado } = get()
    if (!itemSelecionado) return
    set(state => ({
      itens: state.itens.map(i =>
        i.id === itemSelecionado ? { ...i, cancelado: true } : i
      ),
      itemSelecionado: null,
    }))
  },

  /** Cancela uma lista de itens de uma vez (batch) */
  cancelarItens(ids) {
    const idSet = new Set(ids)
    set(state => ({
      itens: state.itens.map(i =>
        idSet.has(i.id) ? { ...i, cancelado: true } : i
      ),
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

  /** Atualiza o contador do ERP (ordem_item) retornado pelo GravaItens */
  atualizarContadorERP(id, contadorERP) {
    set(state => ({
      itens: state.itens.map(it =>
        it.id === id ? { ...it, contador: contadorERP } : it
      ),
    }))
  },

  cancelarConta() {
    set({ itens: [], itemSelecionado: null, cpf: '' })
  },

  /** Subtotal exclui itens cancelados */
  subtotal() {
    return get().itens
      .filter(i => !i.cancelado)
      .reduce((acc, i) => acc + i.valor_unitario * i.quantidade, 0)
  },
  }),
  {
    name: 'carrinho-store',
    // itemSelecionado não persiste — sempre começa sem seleção
    partialize: (state) => ({ itens: state.itens, cpf: state.cpf }),
  }
))
