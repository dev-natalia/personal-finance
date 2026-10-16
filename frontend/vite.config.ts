import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// Cores da direção visual "comprovante" (papel e tinta), as mesmas de src/index.css.
const PAPER = '#F3F5F2'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registro em arquivo próprio (registerSW.js): a CSP `default-src 'self'` bloqueia script inline.
      injectRegister: 'script',
      // Os ícones já entram pelo globPatterns; sem isto, iriam duas vezes para o cache.
      includeManifestIcons: false,
      manifest: {
        name: 'Finanças',
        short_name: 'Finanças',
        description: 'Anote gastos e receitas em segundos e acompanhe seu saldo.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: PAPER,
        background_color: PAPER,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Só o esqueleto do app vai para o cache; dados da API sempre vêm da rede.
        // O manifesto entra sozinho pelo plugin.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Versão nova assume na hora (sem esperar fechar todas as abas) e apaga o cache antigo.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Nada embutido como data: (fontes pequenas da Recursive seriam): a CSP `default-src 'self'` bloqueia.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // Em desenvolvimento a API roda no uvicorn; o navegador só fala com o Vite (mesma origem).
    proxy: { '/api': { target: 'http://127.0.0.1:8000' } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    css: false,
  },
})
