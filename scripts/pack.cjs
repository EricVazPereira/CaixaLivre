'use strict'
/**
 * pack.cjs — Gera o instalador Windows
 *
 * Define CSC_IDENTITY_AUTO_DISCOVERY=false antes de chamar o electron-builder,
 * evitando o download do winCodeSign (que falha sem permissão de admin no Windows).
 */

const { execSync } = require('child_process')
const { rmSync, existsSync } = require('fs')
const path = require('path')

// Desabilita assinatura de código — não há certificado neste projeto
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

const root = path.join(__dirname, '..')

// 0. Limpa builds anteriores para garantir substituição completa dos arquivos
console.log('\n🧹 Limpando builds anteriores...\n')
for (const dir of ['dist', 'release']) {
  const full = path.join(root, dir)
  if (existsSync(full)) {
    rmSync(full, { recursive: true, force: true })
    console.log(`   removido: ${dir}/`)
  }
}

// 1. Compila o React
console.log('\n📦 Compilando frontend...\n')
execSync('npm run build', { cwd: root, stdio: 'inherit' })

// 2. Recompila o serialport para o Electron
console.log('\n🔧 Reconstruindo módulos nativos...\n')
execSync('node scripts/rebuild-native.cjs', { cwd: root, stdio: 'inherit' })

// 3. Gera o instalador
console.log('\n🚀 Gerando instalador Windows...\n')
execSync('electron-builder build --win --publish=never', { cwd: root, stdio: 'inherit' })

console.log('\n✅ Instalador gerado em release/\n')
