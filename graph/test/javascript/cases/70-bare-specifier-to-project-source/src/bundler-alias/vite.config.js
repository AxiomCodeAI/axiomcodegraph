import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath, URL } from 'node:url';

// the only place '@' and '~shared' are declared: nothing nearer maps them
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
}));
