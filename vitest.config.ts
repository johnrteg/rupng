import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
// Same @repo/* -> SOURCE discovery the service bundler uses, so a new package needs no
// change here (and tests never resolve to stale built bin/). The one place a new package
// must still be listed is `paths` in packages/tsconfig/base.json (static JSON, for tsc/tsx).
import { repoAliases } from './packages/build/aliases.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: repoAliases(),
  },
  test: {
    globals: true,
    environment: 'node',
    root,
    include: ['packages/**/src/**/*.{test,spec}.{ts,tsx,js}','packages/**/tests/**/*.{ts,js}','cloud/test/**/*.{test,spec}.{ts,tsx,js}'],
    exclude: ['**/node_modules/**','**/bin/**','**/cdk.out/**']
  }
});
