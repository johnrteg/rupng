---
name: tsconfig-paths-relisting
description: Convention for path aliases in apps/core/* tsconfig (re-list @repo/* because extends doesn't merge paths)
metadata:
  type: project
---

Each `apps/core/*` service tsconfig that defines local path aliases (`@model/*`, `@api/*`, etc.) must
**re-list the `@repo/*` source mappings** explicitly, because TypeScript's `extends` **replaces** the
`compilerOptions.paths` object wholesale — it does not merge with the base (`@repo/tsconfig/base.json`).
Also set `"baseUrl": "."` so tsc, the editor TS server, and the bundler all honor `paths` identically.

**Why:** the user chose to keep re-listing (decided 2026-06) rather than dropping `@repo/*` and letting
node_modules symlinks resolve them — re-listing keeps resolution pointed at **source** (`packages/*/src`),
which is correct for a live monorepo; node_modules fallback resolves to built `bin/` output and was the
cause of stale `@repo/*` IDE false-positives.

**How to apply:** when scaffolding a new `apps/core/<svc>` tsconfig, copy the `@repo/*` block from
`apps/core/web/tsconfig.json` using depth **`../../../packages/...`** (apps are three levels below the repo
root; `packages/tsconfig` is two, which is why base.json uses `../../`). Then add the service's local
aliases below it.
