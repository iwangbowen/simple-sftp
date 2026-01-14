import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__mocks__/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/out/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/out/**', '**/*.test.ts']
    },
    testTimeout: 10000
  },
  resolve: {
    alias: {
      'vscode': path.resolve(__dirname, 'src/__mocks__/vscode.ts')
    }
  }
});
