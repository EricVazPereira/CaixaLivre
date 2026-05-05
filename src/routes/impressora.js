const { Router } = require('express')
const { exec }   = require('child_process')
const os         = require('os')

const router = Router()

/** Executa script PowerShell via EncodedCommand */
function ps(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message))
        resolve((stdout || '').trim())
      }
    )
  })
}

/** POST /api/impressora/teste — imprime na impressora padrão do Windows */
router.post('/teste', async (_req, res) => {
  console.log(`[impressora] POST /teste — computador: ${os.hostname()}`)
  try {
    const linhasTexto = [
      '================================',
      '       CAIXALIVRE - TESTE       ',
      '================================',
      '',
      '   Impressora configurada!      ',
      '',
      '================================',
      '', '', '',
    ].map(l => `'${l}'`).join(', ')

    const script = [
      `try {`,
      `  $linhas = @(${linhasTexto})`,
      `  ($linhas -join [Environment]::NewLine) | Out-Printer`,
      `  Write-Output 'OK'`,
      `} catch {`,
      `  Write-Output "ERRO_IMPRESSAO"`,
      `}`,
    ].join('\n')

    const saida = await ps(script)

    if (saida.startsWith('ERRO_')) {
      return res.status(200).json({ ok: false, erro: 'Falha ao enviar para a impressora padrão.' })
    }

    console.log(`[impressora] Impresso na impressora padrão ✓`)
    res.json({ ok: true })

  } catch (e) {
    console.error('[impressora] POST /teste', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

module.exports = router
