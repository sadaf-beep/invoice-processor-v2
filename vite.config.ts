import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Note: ANTHROPIC_API_KEY is intentionally NOT wired into `define` here.
// It's read only by the serverless function in api/extract.ts (server-side,
// Node runtime) — never inlined into the client bundle.
export default defineConfig(() => {
    return {
      server: {
        port: 3001,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
