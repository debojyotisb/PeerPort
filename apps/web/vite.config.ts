import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  },
  resolve: {
    alias: {
      '@peerport/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@peerport/transfer-protocol': path.resolve(__dirname, '../../packages/transfer-protocol/src/index.ts'),
      '@peerport/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts')
    }
  }
});
