// Resolução de referência do totem
export const REF_W = 1280
export const REF_H = 800

/**
 * Aplica transform: scale() no #root para que o app
 * sempre preencha a tela inteira, independente da resolução real.
 * Usa apenas a proporção horizontal (scaleX) para garantir que
 * nenhum elemento seja cortado verticalmente.
 */
export function aplicarEscala() {
  const root = document.getElementById('root')
  if (!root) return

  // Escala baseada apenas na largura — evita corte vertical
  const scale = window.innerWidth / REF_W

  root.style.width          = `${REF_W}px`
  root.style.height         = `${REF_H}px`
  root.style.transform      = `scale(${scale})`
  root.style.transformOrigin = 'top left'
  root.style.position       = 'absolute'
  root.style.top            = '0px'
  root.style.left           = '0px'
  root.style.overflow       = 'visible'   // nunca corta conteúdo

  document.body.style.background = '#1a3a5c'
  document.body.style.overflow   = 'hidden'
  document.body.style.margin     = '0'
}
