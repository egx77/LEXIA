import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: { LEXIA_DATA_DIR: 'memory://', LEXIA_ENV: 'test' },
  },
});
