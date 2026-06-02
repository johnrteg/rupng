import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.{test,spec}.{ts,tsx,js}','packages/**/tests/**/*.{ts,js}'],
    exclude: ['**/node_modules/**','**/bin/**']
  }
});