import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Prioritize system env, then .env file, then the provided fallback key
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY || "AIzaSyCxWtLWoADMy_ll-CjUno5sxt2Oo98kT04"),
    },
    build: {
      rollupOptions: {
        external: ['pdfjs-dist']
      }
    }
  };
});