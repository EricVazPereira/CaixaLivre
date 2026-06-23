/**
 * IconBalanca — balança de dois pratos, estilo tabler/outline.
 * Stroke 1.5 · fill none · currentColor · 24×24 viewBox.
 * Compatível com qualquer tamanho via prop `size`.
 */
export default function IconBalanca({ size = 24, className = '', style = {} }) {
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
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* Base */}
      <line x1="8"  y1="21" x2="16" y2="21" />
      {/* Haste vertical */}
      <line x1="12" y1="21" x2="12" y2="6"  />
      {/* Braço horizontal */}
      <line x1="3"  y1="6"  x2="21" y2="6"  />
      {/* Fio esquerdo */}
      <line x1="3"  y1="6"  x2="3"  y2="13" />
      {/* Fio direito */}
      <line x1="21" y1="6"  x2="21" y2="13" />
      {/* Prato esquerdo (arco) */}
      <path d="M1 13 Q3 16.5 5 13" />
      {/* Prato direito (arco) */}
      <path d="M19 13 Q21 16.5 23 13" />
    </svg>
  )
}
