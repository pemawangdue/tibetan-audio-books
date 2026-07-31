import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    global: 'globalThis',
    ...(mode === 'test'
      ? {
          'import.meta.env.VITE_AUTH_MODE': JSON.stringify('mock'),
          'import.meta.env.VITE_USE_MOCK_API': JSON.stringify('true'),
          'import.meta.env.VITE_API_URL': JSON.stringify(''),
        }
      : {}),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
}))
