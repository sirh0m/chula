import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const rootEnvDir = path.resolve(here, '../..');
  const env = { ...loadEnv(mode, rootEnvDir, ''), ...process.env };
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4310';

  return {
    root: here,
    envDir: rootEnvDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': here },
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.FRONTEND_PORT || 5317),
      strictPort: true,
      allowedHosts: ['.trycloudflare.com', ...(env.VITE_ALLOWED_HOSTS ? env.VITE_ALLOWED_HOSTS.split(',') : [])],
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(env.FRONTEND_PORT || 5317),
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: path.resolve(here, 'dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 800,
    },
  };
});
