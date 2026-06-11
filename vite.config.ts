/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    electron({
      main: {
        // -> dist-electron/main.js（ESM。package.json type:module 準拠）
        entry: { main: 'src/main/index.ts' },
      },
      preload: {
        // -> dist-electron/preload.cjs（CommonJS。contextIsolation 下の preload）
        input: { preload: 'src/preload/index.ts' },
        vite: {
          build: {
            rolldownOptions: {
              output: { entryFileNames: 'preload.cjs', format: 'cjs' },
            },
          },
        },
      },
    }),
  ],
  // engine 等のユニットテスト（Node 環境）。
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
