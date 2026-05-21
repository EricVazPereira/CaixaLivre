'use strict'
/**
 * main.cjs — Processo principal do Electron
 *
 * Responsabilidades:
 *  1. Definir variáveis de ambiente para o backend antes de carregá-lo
 *  2. Iniciar backend (porta 3001) e agente (porta 3002) no mesmo processo
 *  3. Exibir tela de loading enquanto aguarda os health-checks
 *  4. Verificar comunicação com a balança (se habilitada)
 *  5. Abrir janela principal em tela cheia assim que tudo estiver pronto
 *  6. Encerrar tudo limpo ao fechar o app
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const http = require('http')

// ── Caminhos ──────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged

// Em dev:   raiz do projeto  (electron/../)
// Em prod:  process.resourcesPath  (pasta resources/ ao lado do .exe)
const resourcesDir = isDev
  ? path.join(__dirname, '..')
  : process.resourcesPath

// Network.ini — ao lado do executável (mesma pasta que \img\)
process.env.CAIXALIVRE_INI = isDev
  ? path.join(__dirname, '..', 'Network.ini')
  : path.join(path.dirname(app.getPath('exe')), 'Network.ini')

// Frontend compilado — serve como static pelo Express
process.env.CAIXALIVRE_DIST = path.join(resourcesDir, 'dist')

// Imagens do cliente — pasta \img\ ao lado do executável (fácil substituição)
// Em dev:  D:\CaixaLivre\img\
// Em prod: <pasta de instalação>\img\
process.env.CAIXALIVRE_IMG = isDev
  ? path.join(__dirname, '..', 'img')
  : path.join(path.dirname(app.getPath('exe')), 'img')

// Raiz do backend (src/ + node_modules/)
const backendRoot = path.join(resourcesDir, 'backend')

// ── Estado global ─────────────────────────────────────────────────────────────
let backendServer = null   // http.Server do backend (porta 3001)
let agenteHandle  = null   // { server, portManager } do agente (porta 3002)

// ── Limpeza de portas ─────────────────────────────────────────────────────────
function liberarPorta(porta) {
  return new Promise(resolve => {
    const { exec } = require('child_process')
    exec(
      `FOR /F "tokens=5" %P IN ('netstat -ano ^| findstr ":%${porta} " ^| findstr LISTENING') DO taskkill /F /PID %P`,
      { shell: 'cmd.exe', windowsHide: true },
      () => resolve()
    )
  })
}

// ── Utilitário: aguarda /api/health retornar 200 ──────────────────────────────
function aguardarServidor(porta, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now()
    const testar = () => {
      const req = http.get(
        { hostname: 'localhost', port: porta, path: '/api/health', timeout: 2000 },
        res => (res.statusCode === 200 ? resolve() : agendar())
      )
      req.on('error',   agendar)
      req.on('timeout', () => { req.destroy(); agendar() })
      function agendar() {
        if (Date.now() - inicio > timeoutMs)
          return reject(new Error(`Timeout aguardando porta ${porta}`))
        setTimeout(testar, 600)
      }
    }
    testar()
  })
}

// ── Verifica balança via backend ──────────────────────────────────────────────
/**
 * Consulta /api/balanca/config — se balança estiver desabilitada no INI, pula.
 * Se habilitada, chama /api/balanca/teste para checar comunicação serial.
 * Retorna: { habilitada: bool, ok: bool }
 */
function verificarBalanca() {
  return new Promise(resolve => {
    const reqConfig = http.get(
      { hostname: 'localhost', port: 3001, path: '/api/balanca/config', timeout: 4000 },
      res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          let cfg = {}
          try { cfg = JSON.parse(data) } catch { /* ignore */ }

          if (!cfg.habilitada) return resolve({ habilitada: false, ok: true })

          // Balança habilitada — testa comunicação serial
          const reqTeste = http.get(
            { hostname: 'localhost', port: 3001, path: '/api/balanca/teste', timeout: 5000 },
            resTeste => {
              let d = ''
              resTeste.on('data', chunk => { d += chunk })
              resTeste.on('end', () => {
                let r = {}
                try { r = JSON.parse(d) } catch { /* ignore */ }
                resolve({ habilitada: true, ok: r.ok === true })
              })
            }
          )
          reqTeste.on('error',   () => resolve({ habilitada: true, ok: false }))
          reqTeste.on('timeout', () => { reqTeste.destroy(); resolve({ habilitada: true, ok: false }) })
        })
      }
    )
    reqConfig.on('error',   () => resolve({ habilitada: false, ok: true }))
    reqConfig.on('timeout', () => { reqConfig.destroy(); resolve({ habilitada: false, ok: true }) })
  })
}

// ── Aguarda decisão do usuário na tela de erro de balança ────────────────────
function aguardarDecisaoBalanca() {
  return new Promise(resolve => {
    ipcMain.once('balance-retry',    () => resolve('retry'))
    ipcMain.once('balance-continuar', () => resolve('continuar'))
  })
}

// ── Inicialização principal ───────────────────────────────────────────────────
async function iniciar() {
  const preloadPath = path.join(__dirname, 'loading-preload.cjs')

  // Tela de loading (sem borda, sempre no topo)
  const loadingWin = new BrowserWindow({
    width: 480, height: 340,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    transparent: false,
    backgroundColor: '#06121F',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  })
  loadingWin.loadFile(path.join(__dirname, 'loading.html'))

  const js = (code) =>
    loadingWin.webContents.executeJavaScript(code).catch(() => {})

  const setStatus = (txt) =>
    js(`document.getElementById('status').textContent = ${JSON.stringify(txt)}`)

  try {
    // 0. Libera portas de instância anterior
    await setStatus('Verificando processos anteriores…')
    await Promise.all([liberarPorta(3001), liberarPorta(3002)])
    await new Promise(r => setTimeout(r, 1500))

    // 1. Backend (Firebird + API REST)
    await setStatus('Iniciando servidor…')
    const { start: startBackend } = require(path.join(backendRoot, 'src', 'server'))
    backendServer = await startBackend()

    // 2. Agente local (balança serial)
    await setStatus('Iniciando agente local…')
    const { start: startAgente } = require(path.join(backendRoot, 'src', 'agente'))
    agenteHandle = await startAgente()

    // 3. Confirma que ambos respondem ao health-check
    await setStatus('Verificando serviços…')
    await Promise.all([
      aguardarServidor(3001),
      aguardarServidor(3002),
    ])

    // 4. Verifica balança (loop até OK ou usuário escolher continuar sem ela)
    await setStatus('Verificando balança…')
    while (true) {
      const balanca = await verificarBalanca()
      if (!balanca.habilitada || balanca.ok) break  // OK ou desabilitada — prossegue

      // Balança habilitada mas sem comunicação → mostra tela de erro
      await js('showError()')

      const decisao = await aguardarDecisaoBalanca()

      if (decisao === 'continuar') break  // usuário escolheu continuar sem balança

      // Retry: volta ao estado normal e tenta de novo
      await js('hideError()')
      await setStatus('Verificando balança…')
    }

    // 5. Tudo pronto — abre a janela principal
    if (!loadingWin.isDestroyed()) loadingWin.close()

    const win = new BrowserWindow({
      width:  1280,
      height: 800,
      fullscreen: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    win.loadURL('http://localhost:3001')

    // Bloqueia popups e navegação externa
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('http://localhost:3001')) e.preventDefault()
    })

    win.on('closed', () => app.quit())

  } catch (err) {
    if (!loadingWin.isDestroyed()) loadingWin.close()
    dialog.showErrorBox(
      'Falha ao iniciar CaixaLivre',
      `Verifique o Network.ini e tente novamente.\n\nDetalhe: ${err.message}`
    )
    app.quit()
  }
}

// ── Ciclo de vida ─────────────────────────────────────────────────────────────
app.whenReady().then(iniciar)

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  console.log('🛑 Encerrando serviços...')
  try {
    if (agenteHandle?.portManager) agenteHandle.portManager.close()
    if (agenteHandle?.server)      agenteHandle.server.close()
    if (backendServer)             backendServer.close()
  } catch (e) {
    console.error('Erro ao encerrar serviços:', e.message)
  }
})
