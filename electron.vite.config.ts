import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const shared = { '@shared': resolve(__dirname, 'src/shared'), '@locales': resolve(__dirname, 'locales') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { outDir: 'out/main' },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/preload',
      // Sandboxed preloads cannot load ES modules: emit one CommonJS file.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: shared,
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      // electron-vite leaves code unminified; the interface ships minified (and without React's dev build).
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          follows: resolve(__dirname, 'src/renderer/follows.html'),
        },
      },
    },
  },
});
