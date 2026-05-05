import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

/** Lê um valor do Network.ini sem dependências externas */
function lerIni(secao, chave, padrao) {
  try {
    const conteudo = fs.readFileSync(path.join(process.cwd(), 'Network.ini'), 'utf-8')
    let dentro = false
    for (const linha of conteudo.split(/\r?\n/)) {
      const t = linha.trim()
      if (!t || t.startsWith(';') || t.startsWith('#')) continue
      if (t.startsWith('[')) { dentro = t.toLowerCase() === `[${secao.toLowerCase()}]`; continue }
      if (dentro) {
        const [k, ...v] = t.split('=')
        if (k.trim() === chave) return v.join('=').trim()
      }
    }
  } catch {}
  return padrao
}

const backendPorta = parseInt(lerIni('Servidor', 'Porta', '3001'), 10) || 3001

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${backendPorta}`,
        changeOrigin: true,
      },
    },
  },
})
