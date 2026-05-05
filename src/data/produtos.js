// Mock de produtos por código de barras
export const produtos = {
  '7891000100103': { id: '7891000100103', nome: 'Leite Integral 1L', preco: 4.99, unidade: 'un' },
  '7891000315507': { id: '7891000315507', nome: 'Nescafé Tradicional 500g', preco: 22.90, unidade: 'un' },
  '7891910000197': { id: '7891910000197', nome: 'Arroz Tio João 5kg', preco: 27.50, unidade: 'un' },
  '7896036090046': { id: '7896036090046', nome: 'Feijão Carioca 1kg', preco: 8.99, unidade: 'un' },
  '7891149410116': { id: '7891149410116', nome: 'Macarrão Espaguete 500g', preco: 4.49, unidade: 'un' },
  '7896085088555': { id: '7896085088555', nome: 'Óleo de Soja 900ml', preco: 7.99, unidade: 'un' },
  '7891098010575': { id: '7891098010575', nome: 'Sabão em Pó 1kg', preco: 12.90, unidade: 'un' },
  '7891155740117': { id: '7891155740117', nome: 'Açúcar Cristal 1kg', preco: 5.49, unidade: 'un' },
  '7896045100264': { id: '7896045100264', nome: 'Sal Refinado 1kg', preco: 2.99, unidade: 'un' },
  '7891000244388': { id: '7891000244388', nome: 'Chocolate ao Leite 90g', preco: 3.49, unidade: 'un' },
  '0074468060449': { id: '0074468060449', nome: 'Álcool 70% 1L', preco: 9.99, unidade: 'un' },
  '07894650014141': { id: '07894650014141', nome: 'Raid Aerossol 300ml', preco: 18.90, unidade: 'un' },
}

export function buscarProduto(codigo) {
  return produtos[codigo] || null
}
