'use strict'
/**
 * gerar-icone.cjs
 * Converte icon-preview/option1.svg → ICO (build/) + PNG (public/ e build/)
 * Uso: node scripts/gerar-icone.cjs
 */

const fs   = require('fs')
const path = require('path')

const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'))
const toIco = require(path.join(__dirname, '..', 'node_modules', 'to-ico'))

const root    = path.join(__dirname, '..')
const srcSvg  = path.join(root, 'src', 'assets', 'caixalivre-icon.svg')

// Garante pastas
fs.mkdirSync(path.join(root, 'build'),  { recursive: true })
fs.mkdirSync(path.join(root, 'public'), { recursive: true })

async function main() {
  console.log('🎨 Lendo SVG...')
  const svgBuf = fs.readFileSync(srcSvg)

  // 1. Gera PNG 512×512 → build/icon.png  e  public/icon.png
  console.log('📐 Gerando 512×512 PNG...')
  const png512 = await sharp(svgBuf).resize(512, 512).png().toBuffer()
  fs.writeFileSync(path.join(root, 'build',  'icon.png'), png512)
  fs.writeFileSync(path.join(root, 'public', 'icon.png'), png512)
  console.log('   ✓ build/icon.png')
  console.log('   ✓ public/icon.png')

  // 2. Gera PNGs nos tamanhos do ICO
  console.log('📐 Gerando tamanhos para ICO...')
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = await Promise.all(
    sizes.map(s => sharp(svgBuf).resize(s, s).png().toBuffer())
  )

  // 3. Monta ICO com todos os tamanhos → build/icon.ico
  console.log('🖼  Gerando build/icon.ico...')
  const icoBuffer = await toIco(pngBuffers)
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), icoBuffer)
  console.log('   ✓ build/icon.ico')

  // 4. Favicon ICO (32+16) → public/favicon.ico
  console.log('🖼  Gerando public/favicon.ico...')
  const faviconBuf = await toIco([pngBuffers[2], pngBuffers[0]]) // 32 + 16
  fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), faviconBuf)
  console.log('   ✓ public/favicon.ico')

  console.log('\n✅ Todos os ícones gerados com sucesso!')
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
