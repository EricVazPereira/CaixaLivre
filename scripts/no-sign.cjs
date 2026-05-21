'use strict'
/**
 * no-sign.cjs — Função de assinatura no-op para electron-builder
 *
 * Quando referenciada em electron-builder.yml como win.sign,
 * o electron-builder usa esta função em vez do winCodeSign nativo,
 * evitando o download do winCodeSign (que falha no Windows sem permissão
 * de admin para criar symbolic links).
 *
 * O executável gerado NÃO será assinado digitalmente. Para distribuição
 * corporativa interna isso é aceitável. Para publicação na Microsoft Store
 * seria necessário um certificado EV.
 */

module.exports = async (_configuration) => {
  // No-op: assinar código não é necessário para uso interno
}
