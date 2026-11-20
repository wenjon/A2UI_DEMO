import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {a2uiLlmPlugin} from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), a2uiLlmPlugin()],
  server: {port: 5173, open: false, watch: {ignored: ['**/.edge-cdp/**']}},
});
