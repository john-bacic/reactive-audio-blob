import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { VitePWA } from 'vite-plugin-pwa';

function gitCommit() {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return vercelSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  server: { open: true, port: 3000 },
  define: { __GIT_COMMIT__: JSON.stringify(gitCommit()) },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Audio Reactive Blob',
        short_name: 'Blob',
        description: 'Audio reactive blob visualization with Three.js and GLSL',
        theme_color: '#0f0f0f',
        background_color: '#0f0f0f',
        display: 'standalone',
        start_url: '/',
        orientation: 'any',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'] }
    })
  ]
});
