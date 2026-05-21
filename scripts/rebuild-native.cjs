'use strict'
/**
 * rebuild-native.cjs
 *
 * Recompila os módulos Node.js com bindings nativos (serialport)
 * para a versão do Node embutida no Electron.
 *
 * Execute antes de empacotar:
 *   npm run electron:rebuild
 */

const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')

const root = path.join(__dirname, '..')

// Localiza o electron instalado
const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json')
if (!fs.existsSync(electronPkg)) {
  console.error('❌  Electron não encontrado em node_modules.')
  console.error('    Execute: npm install')
  process.exit(1)
}

const electronVersion = JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version
console.log(`\n🔧  Reconstruindo módulos nativos para Electron v${electronVersion}...\n`)

// Caminho para o electron-rebuild instalado localmente
const rebuildBin = path.join(
  root, 'node_modules', '.bin',
  process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild'
)

if (!fs.existsSync(rebuildBin)) {
  console.error('❌  @electron/rebuild não encontrado em node_modules.')
  console.error('    Execute: npm install')
  process.exit(1)
}

// Executa o rebuild dentro de backend/ para que ele encontre os node_modules corretos
try {
  execSync(
    `"${rebuildBin}" -f -w serialport --version ${electronVersion}`,
    {
      cwd: path.join(root, 'backend'),
      stdio: 'inherit',
      shell: true,
    }
  )
  console.log('\n✅  Módulos nativos reconstruídos com sucesso.\n')
} catch (e) {
  console.warn('\n⚠️   Rebuild do serialport falhou.')
  console.warn('    O app será empacotado SEM suporte à balança.')
  console.warn('    Para habilitar: instale MSVC Build Tools + Python 3 e repita.\n')
  // Não falha o build — a balança simplesmente ficará desabilitada no executável
  process.exitCode = 0
}
