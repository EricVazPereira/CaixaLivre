export default function IconBalancaTotem({ size = 24, color = 'currentColor' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
    >
      {/* Corpo trapezoidal — outline */}
      <path
        d="M132.805 59L148.061 100H10.9082L25.21 59H132.805Z"
        stroke={color}
        strokeWidth="6"
      />

      {/* Prato */}
      <rect x="24" y="48" width="108.936" height="6.80851" rx="3.40426" fill={color} />

      {/* Base */}
      <path
        d="M9 105H150V108C150 110.209 148.209 112 146 112H13C10.7909 112 9 110.209 9 108V105Z"
        fill={color}
      />

      {/* Display (transform exato do original) */}
      <rect
        x="59.1915" y="67"
        width="24.5106" height="25.1915"
        transform="rotate(90 59.1915 67)"
        fill={color}
      />

      {/* Teclado 5×3 */}
      <rect x="76.1277" y="67"       width="5.44681" height="5.44681" fill={color} />
      <rect x="86.3405" y="67"       width="5.44681" height="5.44681" fill={color} />
      <rect x="96.5532" y="67"       width="5.44681" height="5.44681" fill={color} />
      <rect x="106.766" y="67"       width="5.44681" height="5.44681" fill={color} />
      <rect x="116.979" y="67"       width="5.44681" height="5.44681" fill={color} />

      <rect x="76.1277" y="76.5319"  width="5.44681" height="5.44681" fill={color} />
      <rect x="86.3405" y="76.5319"  width="5.44681" height="5.44681" fill={color} />
      <rect x="96.5532" y="76.5319"  width="5.44681" height="5.44681" fill={color} />
      <rect x="106.766" y="76.5319"  width="5.44681" height="5.44681" fill={color} />
      <rect x="116.979" y="76.5319"  width="5.44681" height="5.44681" fill={color} />

      <rect x="76.1277" y="86.0638"  width="5.44681" height="5.44681" fill={color} />
      <rect x="86.3405" y="86.0638"  width="5.44681" height="5.44681" fill={color} />
      <rect x="96.5532" y="86.0638"  width="5.44681" height="5.44681" fill={color} />
      <rect x="106.766" y="86.0638"  width="5.44681" height="5.44681" fill={color} />
      <rect x="116.979" y="86.0638"  width="5.44681" height="5.44681" fill={color} />
    </svg>
  )
}
