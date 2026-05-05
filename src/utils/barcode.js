/**
 * Normaliza um código de barras para 14 dígitos com zeros à esquerda.
 * Remove qualquer caractere não-numérico antes de preencher.
 */
export function normalizarCodigo(codigo) {
  return codigo.replace(/\D/g, '').padStart(14, '0')
}
