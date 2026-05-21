'use strict'
/**
 * after-pack.cjs — Remove arquivos desnecessários do pacote Electron após a cópia.
 *
 * Chamado automaticamente pelo electron-builder via "afterPack" no electron-builder.yml.
 * Reduz o tamanho do executável final removendo DLLs não utilizadas.
 */

const fs   = require('fs')
const path = require('path')

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir

  // ffmpeg.dll — codec de vídeo/áudio do Chromium, não utilizado por este app
  const ffmpeg = path.join(appOutDir, 'ffmpeg.dll')
  if (fs.existsSync(ffmpeg)) {
    fs.unlinkSync(ffmpeg)
    console.log('  [after-pack] Removido ffmpeg.dll (-2.6 MB)')
  }
}
