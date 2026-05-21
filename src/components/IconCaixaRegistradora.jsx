/**
 * Ícone de caixa registradora — estilo Tabler/outline
 * stroke 1.5 · 24×24 · currentColor
 */
export default function IconCaixaRegistradora({ size = '1em', style = {}, className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {/* Visor / display */}
      <rect x="11" y="3" width="9" height="5" rx="1" />
      {/* Corpo principal */}
      <rect x="2" y="8" width="20" height="11" rx="2" />
      {/* Linha da gaveta */}
      <line x1="2" y1="17" x2="22" y2="17" />
      {/* Teclas — coluna esquerda */}
      <rect x="5"  y="11" width="2" height="2" rx="0.4" />
      <rect x="9"  y="11" width="2" height="2" rx="0.4" />
      <rect x="5"  y="14" width="2" height="1.2" rx="0.4" />
      <rect x="9"  y="14" width="2" height="1.2" rx="0.4" />
      {/* Área do display interno */}
      <rect x="14" y="11" width="5" height="3.5" rx="0.5" />
    </svg>
  )
}
