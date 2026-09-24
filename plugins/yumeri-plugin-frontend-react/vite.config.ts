import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
});