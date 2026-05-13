const { Router } = require('express')
const { exec }   = require('child_process')
const fs         = require('fs')
const path       = require('path')
const os         = require('os')
const QRCode     = require('qrcode')
const { NFCE_HABILITADO } = require('../config')
const { pegaDadosEmpresa } = require('../erp')

const router = Router()

// ── PowerShell helpers ────────────────────────────────────────────────────────

/** Executa script PowerShell via EncodedCommand (UTF-16LE) */
function ps(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message))
        resolve((stdout || '').trim())
      }
    )
  })
}

// C# para envio de bytes raw via Windows Spooler API
const WINSPOOL_CS = [
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class WinSpool {',
  '  [DllImport("winspool.drv", CharSet=CharSet.Unicode)]',
  '  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);',
  '  [DllImport("winspool.drv")]',
  '  public static extern bool ClosePrinter(IntPtr h);',
  '  [DllImport("winspool.drv", CharSet=CharSet.Unicode)]',
  '  public static extern int StartDocPrinter(IntPtr h, int lv, ref DocInfo di);',
  '  [DllImport("winspool.drv")]',
  '  public static extern bool EndDocPrinter(IntPtr h);',
  '  [DllImport("winspool.drv")]',
  '  public static extern bool StartPagePrinter(IntPtr h);',
  '  [DllImport("winspool.drv")]',
  '  public static extern bool EndPagePrinter(IntPtr h);',
  '  [DllImport("winspool.drv")]',
  '  public static extern bool WritePrinter(IntPtr h, IntPtr p, int n, out int w);',
  '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
  '  public struct DocInfo {',
  '    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;',
  '    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;',
  '    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;',
  '  }',
  '}',
].join('\n')

/**
 * Caminho do DLL pré-compilado do helper WinSpool.
 * Compilado uma vez, carregado rapidamente em todas as impressões seguintes.
 */
const WINSPOOL_DLL = path.join(os.tmpdir(), 'CaixaLivreWinSpool.dll')

/** Nome da impressora padrão cacheado no startup — evita Get-CimInstance a cada impressão */
let cachedPrinterName = null

/**
 * Pré-aquece em background assim que o módulo carrega:
 *   1. Compila/verifica o DLL WinSpool (elimina Add-Type lento)
 *   2. Cacheia o nome da impressora padrão (elimina Get-CimInstance por impressão)
 */
setImmediate(async () => {
  // ── 1. DLL ──────────────────────────────────────────────────────────────
  if (fs.existsSync(WINSPOOL_DLL)) {
    console.log('[impressora] WinSpool DLL encontrado ✓')
  } else {
    console.log('[impressora] Compilando WinSpool DLL (apenas na primeira execução)…')
    try {
      await ps(`Add-Type -TypeDefinition '${WINSPOOL_CS}' -Language CSharp -OutputAssembly '${WINSPOOL_DLL}' -ErrorAction Stop\nWrite-Output 'ok'`)
      console.log('[impressora] WinSpool DLL compilado e salvo ✓')
    } catch (e) {
      console.warn('[impressora] Pré-compilação falhou (usará compilação inline):', e.message)
    }
  }

  // ── 2. Nome da impressora padrão ─────────────────────────────────────────
  try {
    const nome = await ps(`(Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name | Select-Object -First 1`)
    cachedPrinterName = nome.trim()
    console.log(`[impressora] Impressora padrão: "${cachedPrinterName}" ✓`)
  } catch (e) {
    console.warn('[impressora] Não foi possível pré-carregar impressora:', e.message)
  }
})

/**
 * Envia bytes raw para a impressora padrão do Windows via WinSpool API.
 * Grava os bytes num arquivo .bin temporário para que o script PS fique
 * curto o suficiente para o EncodedCommand (limite ~8 KB).
 * @param {Buffer} cupomBuffer — bytes ESC/POS prontos
 */
function psRaw(cupomBuffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `cupom_${Date.now()}.bin`)

    fs.writeFile(tmpFile, cupomBuffer, (writeErr) => {
      if (writeErr) return reject(writeErr)

      // Carrega o DLL pré-compilado (rápido) — ou compila inline se ainda não existir
      const loadType = fs.existsSync(WINSPOOL_DLL)
        ? `Add-Type -Path '${WINSPOOL_DLL}' -ErrorAction SilentlyContinue`
        : `Add-Type -TypeDefinition '${WINSPOOL_CS}' -Language CSharp -ErrorAction SilentlyContinue`

      // tmpFile pode ter barras invertidas — em PS single-quoted strings são literais ✓
      const script = [
        loadType,
        `$bytes = [IO.File]::ReadAllBytes('${tmpFile}')`,
        `Remove-Item '${tmpFile}' -ErrorAction SilentlyContinue`,
        // Usa nome cacheado (instantâneo) ou faz a query WMI como fallback
        cachedPrinterName
          ? `$pn = '${cachedPrinterName}'`
          : `$pn = (Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name | Select-Object -First 1`,
        `if (-not $pn) { throw 'Nenhuma impressora padrao encontrada' }`,
        `$h = [IntPtr]::Zero`,
        `if (![WinSpool]::OpenPrinter($pn, [ref]$h, [IntPtr]::Zero)) { throw "OpenPrinter falhou: $pn" }`,
        `$di = New-Object WinSpool+DocInfo`,
        `$di.pDocName  = 'CupomCaixaLivre'`,
        `$di.pDatatype = 'RAW'`,
        `if ([WinSpool]::StartDocPrinter($h, 1, [ref]$di) -le 0) { [WinSpool]::ClosePrinter($h); throw 'StartDocPrinter falhou' }`,
        `[WinSpool]::StartPagePrinter($h) | Out-Null`,
        `$ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)`,
        `[Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)`,
        `$w = 0`,
        `[WinSpool]::WritePrinter($h, $ptr, $bytes.Length, [ref]$w) | Out-Null`,
        `[Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)`,
        `[WinSpool]::EndPagePrinter($h) | Out-Null`,
        `[WinSpool]::EndDocPrinter($h) | Out-Null`,
        `[WinSpool]::ClosePrinter($h) | Out-Null`,
        `Write-Output "OK:$w"`,
      ].join('\n')

      ps(script)
        .then(resolve)
        .catch(reject)
        .finally(() => fs.unlink(tmpFile, () => {})) // garante limpeza
    })
  })
}

// ── ESC/POS — constantes e comandos ──────────────────────────────────────────

const ESC = 0x1B
const GS  = 0x1D
const LF  = 0x0A

const CMD_INIT     = Buffer.from([ESC, 0x40])              // Inicializa
const CMD_FONT_B   = Buffer.from([ESC, 0x4D, 0x01])        // Font B (menor, 9×17 dots)
const CMD_BOLD_ON  = Buffer.from([ESC, 0x45, 0x01])        // Negrito on
const CMD_BOLD_OFF = Buffer.from([ESC, 0x45, 0x00])        // Negrito off
const CMD_ALIGN_L  = Buffer.from([ESC, 0x61, 0x00])        // Alinhar esquerda
const CMD_ALIGN_C  = Buffer.from([ESC, 0x61, 0x01])        // Alinhar centro
const CMD_FEED3      = Buffer.from([LF, LF, LF])             // Avanço de papel
const CMD_CUT        = Buffer.from([GS, 0x56, 0x42, 0x03])  // Corte parcial
const CMD_LS_TIGHT   = Buffer.from([ESC, 0x33, 46])          // Espaço entre linhas: ~1/2 char Font B (unit = 1/360")
const CMD_LS_DEFAULT = Buffer.from([ESC, 0x32])              // Espaço entre linhas: padrão (1/6 polegada)

/** Converte string (já deacentuada) para bytes Latin-1 com LF */
function t(s)  { return Buffer.from(da(String(s)) + '\n', 'latin1') }

/**
 * Gera bytes ESC/POS para QR code (Model 2, EC M).
 * @param {string} url
 * @param {number} [moduleSize=5] — tamanho do módulo em dots (1-16).
 *   Use 3 para o QR no page mode (lado a lado), 5 para QR standalone.
 */
function qrEscPos(url, moduleSize = 5) {
  const data     = Buffer.from(url, 'ascii')
  const storeLen = data.length + 3   // 3 = cn(0x31) + fn(0x50) + m(0x30)
  const pL       = storeLen & 0xFF
  const pH       = (storeLen >> 8) & 0xFF
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),       // Modelo 2
    Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize & 0xFF]), // Tamanho módulo
    Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),              // Correção M
    Buffer.from([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]),                  // Armazena dados
    data,
    Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),              // Imprime QR
  ])
}

// ── Formatação de texto (largura W = 64 colunas — Font B 9 dots × 64 = 576) ──

const W      = 64   // Font B: 9 dots/char × 64 = 576 dots (largura total)
const N_W    = 3    // coluna N:      "001"
const COD_W  = 7    // coluna Código: código do produto (padEnd fornece 1 char de gap)
const QT_W   = 8    // coluna QT:     "2UN" / "0,995KG"
const VL_W   = 8    // coluna VL UN:  "9.999,99" = 8 chars max
const TOT_W  = 8    // coluna Total:  "9.999,99" = 8 chars max
// DESC_W = 64 - 3 - 1(sp N→COD) - 7(COD inclui 1 char de gap) - 8 - 8 - 8 = 29
const DESC_W = W - N_W - 1 - COD_W - QT_W - VL_W - TOT_W  // 29

/** Remove acentos e caracteres combinantes */
function da(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function brl(n) {
  const [int, dec] = Number(n).toFixed(2).split('.')
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec
}
function brlKg(n)  { return Number(n).toFixed(3).replace('.', ',') }  // 3 casas (obrigatório por lei)
function sep(ch = '=') { return ch.repeat(W) }

function center(s) {
  const str = da(String(s)).slice(0, W)
  const pad = Math.max(0, W - str.length)
  return ' '.repeat(Math.floor(pad / 2)) + str + ' '.repeat(Math.ceil(pad / 2))
}

/** Texto à esquerda + valor à direita, separados por espaços */
function cols(left, right) {
  const r = da(String(right))
  const l = da(String(left)).slice(0, W - r.length - 1)
  return l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r
}

function rpad(s, w) { return da(String(s)).slice(0, w).padEnd(w) }
function lpad(s, w) { return da(String(s)).slice(0, w).padStart(w) }

// Formatadores de dados cadastrais
function fmtCnpj(s) {
  const d = String(s).replace(/\D/g, '')
  return d.length === 14
    ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
    : s
}
function fmtIe(s) {
  const d = String(s).replace(/\D/g, '')
  return d.length === 12
    ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}.${d.slice(9)}`
    : s
}
function fmtCep(s) {
  const d = String(s).replace(/\D/g, '')
  return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5)}` : s
}
function fmtTel(s) {
  const d = String(s).replace(/\D/g, '')
  if (d.length === 10) return `${d.slice(0,2)} ${d.slice(2,6)}-${d.slice(6)}`
  if (d.length === 11) return `${d.slice(0,2)} ${d.slice(2,7)}-${d.slice(7)}`
  return s
}
function fmtCpf(s) {
  const d = String(s).replace(/\D/g, '')
  return d.length === 11
    ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
    : s
}

/** cols com largura variável (para linhas indentadas) */
function colsW(left, right, w) {
  const r = da(String(right))
  const l = da(String(left)).slice(0, w - r.length - 1)
  return l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r
}

// ── Itens — colunas fixas: N(3) Código(7) Descrição(28) QT(8) VL(8) Total(8) ──

const UNIDADES_PESO = new Set(['KG', 'G', 'LT', 'ML', 'L'])

/**
 * Monta uma linha de item com as 6 colunas fixas.
 * Layout: "001 1234567 DESCRICAO PRODUTO         2UN    4,89    9,78"
 *
 * @param {number} seq   — número sequencial (001, 002…)
 * @param {object} item  — { codigo?, descricao, quantidade, unidade, valor_unitario }
 * @param {string} qtFmt — string já formatada para a coluna QT (ex: "2UN" ou "0,995KG")
 */
function linhaItem(seq, item, qtFmt) {
  const n     = String(seq).padStart(3, '0')
  const cod   = da(String(item.produto_codigo || item.codigo || '')).slice(-6).padEnd(COD_W)
  // DESC_W é o limite rígido — trunca sem exceção para não sobrepor a coluna QT
  const desc  = da(String(item.descricao || '')).slice(0, DESC_W).padEnd(DESC_W).slice(0, DESC_W)
  const qt    = String(qtFmt).slice(0, QT_W).padStart(QT_W)
  const vl    = brl(item.valor_unitario).slice(0, VL_W).padStart(VL_W)
  const total = brl(Number(item.valor_unitario) * Number(item.quantidade)).slice(0, TOT_W).padStart(TOT_W)
  return `${n} ${cod}${desc}${qt}${vl}${total}`
}

/** Item por UNIDADE: QT = "2UN", "6UN" */
function linhaItemUN(seq, item) {
  const qty = String(Math.round(Number(item.quantidade)))
  const un  = da(String(item.unidade ?? 'UN')).slice(0, 3).toUpperCase()
  return linhaItem(seq, item, `${qty}${un}`)
}

/** Item por PESO/VOLUME: QT = "0,995KG" (1 linha, 3 casas decimais por lei) */
function linhaItemKG(seq, item) {
  const qty = brlKg(item.quantidade)
  const un  = da(String(item.unidade ?? 'KG')).slice(0, 3).toUpperCase()
  return linhaItem(seq, item, `${qty}${un}`)
}

/** Formata a chave de acesso (44 dígitos) em 2 linhas centradas (6+5 grupos de 4) */
function formatarChave(chave) {
  const d = String(chave || '').replace(/\D/g, '').padStart(44, '0').slice(0, 44)
  const grupos = Array.from({ length: 11 }, (_, i) => d.slice(i * 4, i * 4 + 4))
  return [
    center(grupos.slice(0, 6).join(' ')),  // "0000 0000 0000 0000 0000 0000" = 29 chars
    center(grupos.slice(6).join(' ')),      // "0000 0000 0000 0000 0000"      = 24 chars
  ]
}

/** Data/hora no formato brasileiro: "12/05/2026 14:30:25" */
function fmtDatetime(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const FORMAS = {
  pix:     'Pagamento Instantaneo (PIX)',
  credito: 'Cartao de Credito',
  debito:  'Cartao de Debito',
}

const URL_NFCE   = 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx'
const PAPER_DOTS = 576   // 80 mm a 203 DPI
const LOGO_PATH  = path.join(__dirname, '..', '..', '..', 'img', 'logo.bmp')
const LOGO_FIXED_W = 160  // largura fixa do logo em dots (sempre redimensiona para caber aqui)

// ── Fonte 5×7px — row-major, bit7 = coluna 0 (esquerda) ─────────────────────
// Cada char: 7 bytes (um por linha). bits 7-3 = colunas 0-4.
const FONT5x7 = {
  ' ':  [0x00,0x00,0x00,0x00,0x00,0x00,0x00],
  '0':  [0x70,0x88,0x88,0x88,0x88,0x88,0x70],
  '1':  [0x20,0x60,0x20,0x20,0x20,0x20,0x70],
  '2':  [0x70,0x88,0x08,0x10,0x20,0x40,0xF8],
  '3':  [0x70,0x88,0x08,0x30,0x08,0x88,0x70],
  '4':  [0x10,0x30,0x50,0x90,0xF8,0x10,0x10],
  '5':  [0xF8,0x80,0xF0,0x08,0x08,0x88,0x70],
  '6':  [0x70,0x80,0x80,0xF0,0x88,0x88,0x70],
  '7':  [0xF8,0x08,0x10,0x20,0x20,0x20,0x20],
  '8':  [0x70,0x88,0x88,0x70,0x88,0x88,0x70],
  '9':  [0x70,0x88,0x88,0x78,0x08,0x08,0x70],
  'A':  [0x20,0x50,0x88,0x88,0xF8,0x88,0x88],
  'B':  [0xF0,0x88,0x88,0xF0,0x88,0x88,0xF0],
  'C':  [0x70,0x88,0x80,0x80,0x80,0x88,0x70],
  'D':  [0xF0,0x88,0x88,0x88,0x88,0x88,0xF0],
  'E':  [0xF8,0x80,0x80,0xF0,0x80,0x80,0xF8],
  'F':  [0xF8,0x80,0x80,0xF0,0x80,0x80,0x80],
  'G':  [0x70,0x88,0x80,0x98,0x88,0x88,0x78],
  'H':  [0x88,0x88,0x88,0xF8,0x88,0x88,0x88],
  'I':  [0x70,0x20,0x20,0x20,0x20,0x20,0x70],
  'J':  [0x38,0x10,0x10,0x10,0x10,0x90,0x60],
  'K':  [0x88,0x90,0xA0,0xC0,0xA0,0x90,0x88],
  'L':  [0x80,0x80,0x80,0x80,0x80,0x80,0xF8],
  'M':  [0x88,0xD8,0xA8,0x88,0x88,0x88,0x88],
  'N':  [0x88,0xC8,0xA8,0x98,0x88,0x88,0x88],
  'O':  [0x70,0x88,0x88,0x88,0x88,0x88,0x70],
  'P':  [0xF0,0x88,0x88,0xF0,0x80,0x80,0x80],
  'Q':  [0x70,0x88,0x88,0x88,0xA8,0x90,0x68],
  'R':  [0xF0,0x88,0x88,0xF0,0xA0,0x90,0x88],
  'S':  [0x70,0x88,0x80,0x70,0x08,0x88,0x70],
  'T':  [0xF8,0x20,0x20,0x20,0x20,0x20,0x20],
  'U':  [0x88,0x88,0x88,0x88,0x88,0x88,0x70],
  'V':  [0x88,0x88,0x88,0x88,0x88,0x50,0x20],
  'W':  [0x88,0x88,0x88,0xA8,0xA8,0xD8,0x88],
  'X':  [0x88,0x88,0x50,0x20,0x50,0x88,0x88],
  'Y':  [0x88,0x88,0x50,0x20,0x20,0x20,0x20],
  'Z':  [0xF8,0x08,0x10,0x20,0x40,0x80,0xF8],
  ':':  [0x00,0x60,0x60,0x00,0x60,0x60,0x00],
  '-':  [0x00,0x00,0x00,0xF8,0x00,0x00,0x00],
  '/':  [0x08,0x08,0x10,0x20,0x40,0x80,0x80],
  '.':  [0x00,0x00,0x00,0x00,0x00,0x60,0x60],
}
const F_W = 5  // largura do glyph (dots escala 1)
const F_H = 7  // altura do glyph (dots escala 1)

/**
 * Renderiza linhas de texto como pixels (flat Uint8Array, 0=branco/1=preto).
 *
 * Cada item de `lines` pode ser:
 *   - string           → usa defaultScale
 *   - { text, scale }  → usa escala própria (ex: nome em destaque)
 *
 * @param {Array<string|{text:string,scale:number}>} lines
 * @param {number} defaultScale — escala padrão para linhas sem escala própria
 * @param {number} lineGap      — espaço vertical entre linhas em dots
 * @param {'left'|'right'|'center'} align — alinhamento horizontal
 * @param {number} fixedWidth   — largura do canvas (0 = natural)
 * @returns {{ pixels: Uint8Array, width: number, height: number }}
 */
function renderTextBlock(lines, defaultScale = 2, lineGap = 3, align = 'left', fixedWidth = 0) {
  // Normaliza cada linha para { text, scale }
  const items = lines.map(l =>
    typeof l === 'string' ? { text: l, scale: defaultScale } : { scale: defaultScale, ...l }
  )

  // Largura natural de cada linha
  const lineNaturalW = items.map(({ text, scale }) => {
    const n = da(String(text)).length
    const adv = F_W * scale + 1 * scale   // char + gap
    return n > 0 ? n * adv - 1 * scale : 0
  })

  const naturalMaxW = lineNaturalW.reduce((mx, w) => Math.max(mx, w), 1)
  const totalW = fixedWidth > 0 ? fixedWidth : naturalMaxW

  // Altura total
  const lineH = items.map(({ scale }) => F_H * scale)
  const totalH = lineH.reduce((s, h, i) => s + h + (i < items.length - 1 ? lineGap : 0), 0) || 1

  const pixels = new Uint8Array(totalW * totalH)

  let yBase = 0
  items.forEach(({ text, scale }, li) => {
    const str  = da(String(text)).toUpperCase()
    const adv  = F_W * scale + 1 * scale
    const lw   = lineNaturalW[li]

    // Offset de alinhamento
    const xOff = align === 'right'  ? totalW - lw
               : align === 'center' ? Math.floor((totalW - lw) / 2)
               : 0

    for (let ci = 0; ci < str.length; ci++) {
      const rows = FONT5x7[str[ci]] || FONT5x7[' ']
      const xCharBase = xOff + ci * adv
      for (let r = 0; r < F_H; r++) {
        const rb = rows[r]
        for (let sy = 0; sy < scale; sy++) {
          const y = yBase + r * scale + sy
          if (y >= totalH) continue
          for (let c = 0; c < F_W; c++) {
            if (!((rb >> (7 - c)) & 1)) continue
            for (let sx = 0; sx < scale; sx++) {
              const x = xCharBase + c * scale + sx
              if (x >= 0 && x < totalW) pixels[y * totalW + x] = 1
            }
          }
        }
      }
    }
    yBase += lineH[li] + (li < items.length - 1 ? lineGap : 0)
  })

  return { pixels, width: totalW, height: totalH }
}

/**
 * Gera QR code como pixels (flat Uint8Array).
 * Inclui quiet zone de `quietZone` módulos em branco ao redor.
 * @returns {{ pixels: Uint8Array, width: number, height: number } | null}
 */
function renderQRPixels(url, moduleSize = 3, quietZone = 2) {
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
    const sz  = qr.modules.size
    const qz  = quietZone * moduleSize
    const dot = sz * moduleSize + 2 * qz
    const pixels = new Uint8Array(dot * dot)  // zeros = branco (quiet zone)

    for (let r = 0; r < sz; r++) {
      for (let c = 0; c < sz; c++) {
        if (qr.modules.get(r, c)) {
          for (let dy = 0; dy < moduleSize; dy++) {
            for (let dx = 0; dx < moduleSize; dx++) {
              pixels[(qz + r * moduleSize + dy) * dot + (qz + c * moduleSize + dx)] = 1
            }
          }
        }
      }
    }
    return { pixels, width: dot, height: dot }
  } catch (e) {
    console.error('[qr] Falha ao gerar pixels do QR:', e.message)
    return null
  }
}

/**
 * Converte array de pixels (flat Uint8Array) em comando ESC/POS GS v 0.
 */
function pixelsToGSv0(pixels, width, height) {
  const bpr  = Math.ceil(width / 8)               // bytes por linha
  const data = Buffer.alloc(bpr * height, 0)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (pixels[r * width + c]) data[r * bpr + (c >> 3)] |= (1 << (7 - (c & 7)))
    }
  }
  const xL = bpr    & 0xFF,  xH = (bpr    >> 8) & 0xFF
  const yL = height & 0xFF,  yH = (height >> 8) & 0xFF
  return Buffer.concat([Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]), data])
}

/**
 * Compõe dois blocos de pixels lado a lado (esquerda + direita),
 * centralizando verticalmente o bloco mais baixo.
 */
function composeSideBySide(leftPx, rightPx, gap = 10) {
  const totalW = leftPx.width + gap + rightPx.width
  const totalH = Math.max(leftPx.height, rightPx.height)
  const pixels = new Uint8Array(totalW * totalH)

  const lOffY = Math.floor((totalH - leftPx.height)  / 2)
  const rOffY = Math.floor((totalH - rightPx.height) / 2)
  const rX    = leftPx.width + gap

  for (let r = 0; r < leftPx.height; r++)
    for (let c = 0; c < leftPx.width; c++)
      pixels[(r + lOffY) * totalW + c] = leftPx.pixels[r * leftPx.width + c]

  for (let r = 0; r < rightPx.height; r++)
    for (let c = 0; c < rightPx.width; c++)
      if (rX + c < totalW)
        pixels[(r + rOffY) * totalW + rX + c] = rightPx.pixels[r * rightPx.width + c]

  return { pixels, width: totalW, height: totalH }
}

// ── Quebra de linha para bitmap ───────────────────────────────────────────────

/**
 * Quebra `str` em múltiplas linhas para caber em `maxDots` dots de largura,
 * considerando que cada caractere ocupa `(F_W + 1) * scale` dots.
 * Tenta quebrar em espaço; se não houver, corta no limite.
 */
function wrapBitmapLine(str, scale, maxDots) {
  const adv      = (F_W + 1) * scale
  const maxChars = Math.floor(maxDots / adv)
  if (!str || maxChars <= 0) return [str || '']
  const s = da(String(str))
  if (s.length <= maxChars) return [s]
  const out = []
  let rem = s
  while (rem.length > maxChars) {
    const sp = rem.lastIndexOf(' ', maxChars)
    const cut = sp > 0 ? sp : maxChars
    out.push(rem.slice(0, cut).trimEnd())
    rem = rem.slice(cut).trimStart()
  }
  if (rem) out.push(rem)
  return out
}

// ── Parser BMP e cabeçalho com logo ──────────────────────────────────────────

/**
 * Lê um arquivo BMP (1-bit, 8-bit ou 24-bit, sem compressão) e converte para
 * pixels { 0=branco, 1=preto }.
 */
function loadBmpPixels(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf[0] !== 0x42 || buf[1] !== 0x4D) throw new Error('Não é BMP')

  const dataOff = buf.readUInt32LE(10)
  const dibSize = buf.readUInt32LE(14)
  const width   = buf.readInt32LE(18)
  const height  = buf.readInt32LE(22)
  const bpp     = buf.readUInt16LE(28)
  const compr   = buf.readUInt32LE(30)

  if (compr !== 0) throw new Error(`Compressão BMP ${compr} não suportada`)

  const absH    = Math.abs(height)
  const topDown = height < 0
  const pixels  = new Uint8Array(width * absH)
  const srcRow  = r => topDown ? r : absH - 1 - r
  const dark    = (r, g, b) => r + g + b < 384  // threshold

  if (bpp === 1) {
    const ctOff  = 14 + dibSize
    // Lê paleta para saber qual índice representa preto
    const avg0   = buf[ctOff+2] + buf[ctOff+1] + buf[ctOff]    // entry 0 (R+G+B)
    const avg1   = buf[ctOff+6] + buf[ctOff+5] + buf[ctOff+4]  // entry 1
    const rowPad = Math.ceil(Math.ceil(width / 8) / 4) * 4
    for (let r = 0; r < absH; r++) {
      const ro = dataOff + srcRow(r) * rowPad
      for (let c = 0; c < width; c++) {
        const bit = (buf[ro + (c >> 3)] >> (7 - (c & 7))) & 1
        pixels[r * width + c] = (bit === 0 ? avg0 < avg1 : avg1 < avg0) ? 1 : 0
      }
    }
  } else if (bpp === 8) {
    const ctOff  = 14 + dibSize
    const pal    = new Uint8Array(256)
    for (let i = 0; i < 256; i++)
      pal[i] = dark(buf[ctOff+i*4+2], buf[ctOff+i*4+1], buf[ctOff+i*4]) ? 1 : 0
    const rowPad = Math.ceil(width / 4) * 4
    for (let r = 0; r < absH; r++) {
      const ro = dataOff + srcRow(r) * rowPad
      for (let c = 0; c < width; c++) pixels[r * width + c] = pal[buf[ro + c]]
    }
  } else if (bpp === 24) {
    const rowPad = Math.ceil(width * 3 / 4) * 4
    for (let r = 0; r < absH; r++) {
      const ro = dataOff + srcRow(r) * rowPad
      for (let c = 0; c < width; c++)
        pixels[r * width + c] = dark(buf[ro+c*3+2], buf[ro+c*3+1], buf[ro+c*3]) ? 1 : 0
    }
  } else {
    throw new Error(`BMP ${bpp} bpp não suportado`)
  }

  return { pixels, width, height: absH }
}

/**
 * Redimensiona bitmap para largura exata `targetW`, mantendo proporção.
 * Sempre aplica (amplia ou reduz).
 */
function scaleBitmapToWidth(px, targetW) {
  const scaleF = targetW / px.width
  const newW   = targetW
  const newH   = Math.max(1, Math.round(px.height * scaleF))
  const out    = new Uint8Array(newW * newH)
  for (let r = 0; r < newH; r++) {
    const sr = Math.min(Math.floor(r / scaleF), px.height - 1)
    for (let c = 0; c < newW; c++) {
      const sc = Math.min(Math.floor(c / scaleF), px.width - 1)
      out[r * newW + c] = px.pixels[sr * px.width + sc]
    }
  }
  return { pixels: out, width: newW, height: newH }
}

/**
 * Seção de cabeçalho: logo BMP (esquerda) + dados da empresa (direita, alinhado à direita).
 * O nome fantasia é renderizado em escala maior (destaque = "negrito").
 * Se o logo não existir, imprime só o texto centralizado.
 */
function secaoCabecalho(empresa) {
  const parts = []
  const add   = (...b) => b.forEach(x => parts.push(x))

  // Carrega logo (opcional)
  let logoPx = null
  try {
    if (fs.existsSync(LOGO_PATH)) {
      logoPx = scaleBitmapToWidth(loadBmpPixels(LOGO_PATH), LOGO_FIXED_W)
    }
  } catch (e) {
    console.warn('[cabecalho] Logo:', e.message)
  }

  const gap       = 12                                      // espaço logo↔texto
  const textAreaW = PAPER_DOTS - (logoPx ? logoPx.width + gap : 0)

  // Helper: adiciona campo à lista de linhas, quebrando automaticamente se necessário
  const linhas = []
  const addField = (str, scale = 2) => {
    if (!str) return
    wrapBitmapLine(da(String(str)), scale, textAreaW).forEach(l =>
      linhas.push(scale === 2 ? l : { text: l, scale })
    )
  }

  // Nome em destaque (escala 3 = "negrito")
  addField(empresa.NM_FANTASIA || empresa.NM_CONTRIBUINTE || 'EMPRESA', 3)

  // Linha 1: Rua + número
  addField([empresa.LOGRADOURO, empresa.NUMERO].filter(Boolean).join(' '))

  // Linha 2: Bairro + Cidade / UF
  addField([
    empresa.BAIRRO,
    [empresa.MUNICIPIO, empresa.UF].filter(Boolean).join(' / '),
  ].filter(Boolean).join(' '))

  // Bloco com labels alinhados por ponto — os ':' ficam todos na mesma coluna
  // "CNPJ" é o label mais longo (4 chars); os outros são preenchidos com '.'
  const L = 4  // largura do label (sem o ':')
  const fld = (label, value) => value
    ? `${String(label).padEnd(L, '.')}: ${value}`
    : null

  const cadastrais = [
    fld('CNPJ', empresa.CNPJ ? fmtCnpj(empresa.CNPJ) : null),
    fld('CEP',  empresa.CEP  ? fmtCep(empresa.CEP)   : null),
    fld('TEL',  empresa.TELEFONE ? fmtTel(empresa.TELEFONE) : null),
    fld('IE',   empresa.IE   ? fmtIe(empresa.IE)     : null),
  ].filter(Boolean)

  cadastrais.forEach(linha => addField(linha))

  const txtPx = renderTextBlock(linhas, 2, 4, 'left', textAreaW)

  if (logoPx) {
    const composed = composeSideBySide(logoPx, txtPx, gap)
    add(CMD_ALIGN_L, pixelsToGSv0(composed.pixels, composed.width, composed.height))
  } else {
    add(CMD_ALIGN_L, pixelsToGSv0(txtPx.pixels, txtPx.width, txtPx.height))
  }
  add(t(''))

  return Buffer.concat(parts)
}

// ── Seção QR + Protocolo ──────────────────────────────────────────────────────

/**
 * QR (esquerda) + infos NFC-e (direita) compostos como bitmap único (GS v 0).
 * Funciona no TM-T20 sem precisar de page mode.
 */
function secaoQRProtocolo({ protocolo, nfce, serie, dataHora }) {
  const parts = []
  const add   = (...b) => b.forEach(x => parts.push(x))

  const protoStr = da(String(protocolo || '0'.repeat(15)))
  const nfceStr  = da(String(nfce  || '000000'))
  const serieStr = da(String(serie || '001'))
  const dtStr    = da(dataHora || fmtDatetime())

  const qrPx = renderQRPixels(URL_NFCE, 3, 2)   // modulo 3, quiet zone 2

  if (qrPx) {
    const txtPx = renderTextBlock([
      `NFC-E: ${nfceStr}`,
      `SERIE: ${serieStr}`,
      dtStr,
      '-'.repeat(20),
      'PROTOCOLO DE AUTORIZACAO:',
      protoStr,
      dtStr,
    ], 2, 3)

    const composed = composeSideBySide(qrPx, txtPx, 10)

    // Centraliza o bloco no papel
    const padL = Math.max(0, Math.floor((PAPER_DOTS - composed.width) / 2))
    const centW = composed.width + padL
    const centPx = new Uint8Array(centW * composed.height)
    for (let r = 0; r < composed.height; r++)
      for (let c = 0; c < composed.width; c++)
        centPx[r * centW + padL + c] = composed.pixels[r * composed.width + c]

    add(CMD_ALIGN_L)
    add(pixelsToGSv0(centPx, centW, composed.height))
    add(t(''))
  } else {
    // Fallback: QR ESC/POS centralizado + texto abaixo
    add(CMD_ALIGN_C, qrEscPos(URL_NFCE, 4), CMD_ALIGN_L)
    add(t(cols(`NFC-e: ${nfceStr}`, `Serie: ${serieStr}`)))
    add(t(dtStr))
    add(t(sep('-')))
    add(t('Protocolo de Autorizacao:'))
    add(t(center(protoStr)))
    add(t(center(dtStr)))
  }

  return Buffer.concat(parts)
}

// ── Monta Buffer ESC/POS do cupom completo ────────────────────────────────────

function montarCupomESCPOS({
  empresa, itens, total, forma_pagamento, cpf,
  chaveAcesso = '', protocolo = '', nfce = '', serie = '',
}) {
  const parts = []
  const add = (...bufs) => bufs.forEach(b => parts.push(b))
  const agora = new Date()

  add(CMD_INIT)
  add(CMD_FONT_B)      // Font B — menor que Font A, compatível com 48 colunas
  add(CMD_LS_TIGHT)    // Espaço entre linhas uniforme em todo o cupom (~1/2 char)

  // ── Cabeçalho: logo (esq.) + empresa (dir., alinhado à esquerda) ──────────
  add(secaoCabecalho(empresa))
  add(CMD_ALIGN_C)
  add(t(center(NFCE_HABILITADO ? 'CUPOM FISCAL ELETRONICO - NFC-e' : 'COMPROVANTE INTERNO')))
  add(t(''))

  // ── Itens ─────────────────────────────────────────────────────────────────
  add(CMD_ALIGN_L)
  // Cabeçalho das colunas: N | Código | Descrição | QT | VL | Total
  add(CMD_BOLD_ON, t(
    'N'.padEnd(N_W) + ' ' +
    'CODIGO'.padEnd(COD_W) +
    'DESCRICAO'.padEnd(DESC_W) +
    'QT'.padStart(QT_W) +
    'VL UN'.padStart(VL_W) +
    'TOTAL'.padStart(TOT_W)
  ), CMD_BOLD_OFF)

  itens.forEach((item, i) => {
    const isPeso = UNIDADES_PESO.has(String(item.unidade || '').toUpperCase())
    const texto  = isPeso ? linhaItemKG(i + 1, item) : linhaItemUN(i + 1, item)
    add(Buffer.from(da(texto) + '\n', 'latin1'))
  })

  add(t(''))

  // ── Total em negrito ──────────────────────────────────────────────────────
  add(CMD_BOLD_ON, t(cols('VALOR TOTAL R$', brl(total))), CMD_BOLD_OFF)
  add(t(''))

  // ── Pagamento ─────────────────────────────────────────────────────────────
  add(t(cols('FORMA DE PAGAMENTO', 'VALOR PAGO')))
  add(t(cols(FORMAS[forma_pagamento] || String(forma_pagamento).toUpperCase(), brl(total))))
  add(t(''))

  // ── Consumidor ────────────────────────────────────────────────────────────
  add(CMD_ALIGN_C)
  const cpfNum = String(cpf || '').replace(/\D/g, '')
  add(t(center(cpfNum.length === 11 ? `CPF: ${fmtCpf(cpfNum)}` : 'CONSUMIDOR NAO IDENTIFICADO')))
  add(t(''))


  // ── QR Code (esq.) + Protocolo/Data (dir.) em Page Mode ──────────────────
  add(secaoQRProtocolo({
    protocolo: protocolo || '0'.repeat(15),
    nfce:      nfce      || '000000',
    serie:     serie     || '001',
    dataHora:  NFCE_HABILITADO ? (protocolo ? fmtDatetime(agora) : null) : fmtDatetime(agora),
  }))

  // ── Finalização ───────────────────────────────────────────────────────────
  add(CMD_FEED3)
  add(CMD_CUT)

  return Buffer.concat(parts)
}

// ── POST /api/impressora/teste ────────────────────────────────────────────────

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
      return res.json({ ok: false, erro: 'Falha ao enviar para a impressora padrão.' })
    }
    console.log('[impressora] Página de teste impressa ✓')
    res.json({ ok: true })
  } catch (e) {
    console.error('[impressora] POST /teste', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

// ── POST /api/impressora/cupom ────────────────────────────────────────────────

router.post('/cupom', async (req, res) => {
  const { itens, total, forma_pagamento, cpf = '',
          chaveAcesso = '', protocolo = '', nfce = '', serie = '' } = req.body

  if (!Array.isArray(itens) || itens.length === 0)
    return res.status(400).json({ ok: false, erro: 'itens é obrigatório' })
  if (total === undefined || total === null)
    return res.status(400).json({ ok: false, erro: 'total é obrigatório' })
  if (!forma_pagamento)
    return res.status(400).json({ ok: false, erro: 'forma_pagamento é obrigatório' })

  // Busca dados da empresa via API do ERP
  let empresa = {}
  try {
    const api = await pegaDadosEmpresa()
    console.log('[impressora] PegaDadosEmpresa raw:', JSON.stringify(api))
    empresa = {
      CNPJ:            api['CNPJ']          || '',
      IE:              api['IE']            || '',
      NM_FANTASIA:     api['Nome Fantasia'] || '',
      NM_CONTRIBUINTE: api['Razao Social']  || '',
      LOGRADOURO:      api['Rua']           || '',
      NUMERO:          api['Numero']        || '',
      BAIRRO:          api['Bairro']        || '',
      MUNICIPIO:       api['Cidade']        || '',
      UF:              api['UF']            || '',
      CEP:             api['Cep']           || '',
      TELEFONE:        api['Telefone']      || '',
    }
  } catch (e) {
    console.warn('[impressora] Não foi possível buscar dados da empresa via ERP:', e.message)
  }

  // Monta bytes ESC/POS e envia raw para a impressora
  const cupomBuf = montarCupomESCPOS({ empresa, itens, total: Number(total), forma_pagamento, cpf,
                                       chaveAcesso, protocolo, nfce, serie })

  try {
    const saida = await psRaw(cupomBuf)
    if (!saida.startsWith('OK')) {
      console.warn('[impressora] Impressora recusou:', saida)
      return res.json({ ok: false, erro: saida })
    }
    console.log(`[impressora] Cupom impresso ✓ — ${itens.length} item(ns), total R$ ${brl(total)}`)
    res.json({ ok: true })
  } catch (e) {
    console.error('[impressora] POST /cupom', e.message)
    res.status(500).json({ ok: false, erro: e.message })
  }
})

module.exports = router
