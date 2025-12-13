// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  
  build: {
    // Build as a library for server-side rendering
    lib: {
      // The entry is the backend plugin logic
      entry: path.resolve(__dirname, 'src/index.ts'),
      // Emit both CommonJS and ES modules for compatibility
      formats: ['cjs', 'es'],
      fileName: (format) => `index.${format}.js`
    },
    
    rollupOptions: {
      // Mark framework/runtime deps as external so they are not bundled
      external: [
        'yumeri',
        'vue',
      ],
      
      output: {
        globals: {
          'vue': 'Vue', 
          'yumeri': 'yumeri',
        }
      }
    }
  }
});
