# Developing in this monorepo

Turborepo + npm workspaces. This guide covers the layout, the day-to-day commands, and —
most importantly — **exactly what to do when you add a new service or package** so it
builds, bundles, tests, and containerizes like everything else.

> **Reuse, reuse, reuse.** Node services do **not** hand-roll their build. They call the
> shared bundler `rup-bundle` (the `@repo/build` package). A service's build script is
> literally `"build": "rup-bundle"`. Don't copy esbuild flags around.

---

## Layout

```
apps/<domain>/<service>     # deployable apps, grouped by domain (e.g. apps/core/auth)
packages/<name>             # shared libraries, published as @repo/<name>
cloud                       # the AWS CDK app (see cloud/README.md)
```

- Workspaces glob: `apps/*/*`, `packages/*`, `cloud` (note apps are **two** levels deep).
- Apps are grouped by **domain** (`core`, and future `crm`/`email`/…). A service lives at
  `apps/<domain>/<service>`; its `APP_PATH` is `<domain>/<service>`.

## Prerequisites

- **Node 22+** and npm (the workspace `packageManager`).
- **Docker** (for containerizing services and for LocalStack — see `cloud/local/README.md`).
- `npm install` once at the root installs/links every workspace.

## Everyday commands (from the root)

```bash
npm run build        # turbo run build      — build every package + bundle every service
npm run typecheck    # turbo run typecheck  — tsc --noEmit across the repo
npm test             # vitest               — all tests
npm run <service>    # e.g. `npm run auth`  — dev-run one service (tsx watch, hot reload)
```

Turbo caches by task; `--force` re-runs. Filter with `--filter=<name>` (e.g.
`npx turbo run build --filter=auth`).

---

## How builds & resolution work (read once)

- **`@repo/*` always resolves to SOURCE**, everywhere — `tsc` (via `paths` in
  `packages/tsconfig/base.json`), `vitest` (via `resolve.alias`), `tsx` (dev), and
  `rup-bundle` (esbuild `alias`). Nothing depends on built `bin/` at dev/test/bundle time.
- **Services** are bundled by **`rup-bundle`** (esbuild) into a self-contained
  `bin/index.js` that runs on plain **`node`** — `@repo/*` is inlined from source;
  `ajv`/`ajv-formats` stay external (resolved from `node_modules` at runtime, used for
  endpoint + webhook JSON validation). No `tsx` in production.
- **Packages** compile with `tsc` to `bin/`. Packages that import other `@repo/*` use a
  `tsconfig.build.json` (below) so output stays flat.
- `typecheck` is `tsc --noEmit` against source (independent of build output).

---

## Add a new SERVICE app

Location: `apps/<domain>/<service>/`. Example: `apps/core/billing/`.

**1. `package.json`** — pinned **exact** versions (no `^`/`~`), 4-space indent:

```jsonc
{
    "name": "billing",
    "version": "1.0.0",
    "private": true,
    "main": "./bin/index.js",
    "scripts": {
        "build": "rup-bundle",                 // src/index.ts -> bin/index.js (shared bundler)
        "dev": "tsx watch src/index.ts",
        "typecheck": "tsc --noEmit"
    },
    "dependencies": {
        "@repo/common": "*",
        "@repo/endpoint": "*",
        "@repo/services": "*"
    },
    "devDependencies": {
        "@repo/build": "*",                    // REQUIRED — provides `rup-bundle`
        "@repo/tsconfig": "*",
        "@types/node": "25.9.1",
        "tsx": "4.22.4"
    }
}
```

**2. `tsconfig.json`:**

```jsonc
{
    "extends": "@repo/tsconfig/base.json",
    "compilerOptions": { "outDir": "./bin", "types": ["node"] },  // add "vitest/globals" if it has tests
    "include": ["src/**/*"]
}
```

**3. `src/index.ts`** — services extend `@repo/services` (`Service`/`Application`); the
entry picks an implementation by `SERVICE_ROLE` and calls `.run()`. Copy an existing
service (`apps/core/auth`) as the template.

**4. Root `package.json` scripts** — add the dev + Docker triplet (Docker passes both the
workspace name and the domain path):

```jsonc
"billing": "npm run dev -- --filter=billing",
"billing.image": "docker build --build-arg APP_NAME=billing --build-arg APP_PATH=core/billing -t rupapp-billing .",
"billing.docker": "docker run -p 3000:3000 rupapp-billing"
```

**5. `npm install`** (links `@repo/build`'s `rup-bundle` bin into the new app).

**Optional:**
- **Lambda** target: add `src/lambda.ts` exporting `handler`, and
  `"build:lambda": "rup-bundle src/lambda.ts bin/lambda.js"`. Set the CDK `LambdaSpec.handler`
  to `"lambda.handler"`.
- **AWS resources**: export a `ResourceManifest` from `src/infra.ts` (see
  `packages/cloud-spec/README.md`); the CDK app turns it into resources + least-privilege IAM.

> The single root [`Dockerfile`](Dockerfile) serves every service — no per-service
> Dockerfile. `npm run <service>.image` builds it.

---

## Add a new PACKAGE (`@repo/<name>`)

Location: `packages/<name>/`. Example: `packages/billing-core/` → `@repo/billing-core`.

**1. `package.json`:**

```jsonc
{
    "name": "@repo/billing-core",
    "version": "1.0.0",
    "private": true,
    "main": "./bin/index.js",
    "types": "./bin/index.d.ts",
    "scripts": {
        "build": "tsc",                        // see note below if it imports other @repo/*
        "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
        "@repo/tsconfig": "*",
        "@types/node": "25.9.1"
    }
}
```

**2. `tsconfig.json`:**

```jsonc
{
    "extends": "@repo/tsconfig/base.json",
    "compilerOptions": {
        "outDir": "./bin",
        "declaration": true,
        "declarationMap": true,
        "types": ["node"]                      // add "vitest/globals" if it has tests
    },
    "include": ["src/**/*"]
}
```

**3. If the package imports other `@repo/*`**, add a `tsconfig.build.json` and point
`build` at it (`"build": "tsc -p tsconfig.build.json"`). This clears `paths` and pins
`rootDir` so `tsc` resolves deps to their built `.d.ts` instead of pulling sibling SOURCE
into the program (which nests the `bin/` output). Mirror `packages/endpoint/tsconfig.build.json`.

**4. Register the alias in ONE place** so the new package is importable as `@repo/<name>` —
add it to `paths` in `packages/tsconfig/base.json` (used by `tsc`, `tsx`, and the IDE):

```jsonc
"@repo/billing-core": ["../../packages/billing-core/src/index.ts"]
```

That's the only manual step: **vitest** and the **`rup-bundle`** service bundler both
auto-discover `@repo/*` packages (via `packages/build/aliases.mjs`), so they need no change.
(The tsconfig `paths` list stays manual because it's static JSON and can't self-discover.)

**5. `npm install`.**

---

## Conventions

- **TypeScript, strictly typed.** Explicit type annotations on every `const`/`let`
  (`const x : string = …`, not `const x = …`); named `interface`s over inline object types;
  scope related types under a `namespace` (e.g. `Auth.Context`); JSDoc on classes and
  functions; **4-space** indent.
- **Shared scalar primitives** come from `@repo/common`'s `Type` namespace
  (`Type.ID`, `Type.ISODateTime`, `Type.Email`, `Type.PhoneE164`, …) — don't re-declare them.
- **Exact dependency versions** — pin (`"4.22.4"`), never `^`/`~`. Keep a library on the
  **same** version everywhere in the repo.
- **`@types/node`** only on Node packages/services — **not** on browser/frontend apps.
- **Endpoints** are defined once as `RestfulEndpoint` subclasses (shared by web client,
  server, and the CDK gateway). Roles live in `@repo/endpoint`'s `Access` namespace.
- **JSON validation** uses **ajv** as a normal dependency (endpoints + webhook ingestion).
- **Datastore: DynamoDB by default.** It runs identically local↔cloud (no proxy/pooling/IAM
  setup). Use **OpenSearch / analytics** for query-heavy reads, and **RDS/Aurora Postgres**
  (the `Database` facade) only for a genuinely *relational* workload (transactions + reporting,
  e.g. billing). Postgres locally needs a `postgres` container — not LocalStack RDS.
- **AWS access** goes through the `@repo/services` facades (`this.cloud`, `this.kms`, … or a
  service-wired `new S3(this.cloud)`), keyed by cloud-spec logical keys — never raw SDK setup.

## Testing

- **vitest**, globals enabled. Put tests in `src/**/*.test.ts` (or `src/tests/`).
- Add `"vitest/globals"` to the package/app `tsconfig.json` `types` so `describe`/`expect`
  typecheck.
- `/cloud` tests live in `cloud/test/**` (already globbed in `vitest.config.ts`).
- Run: `npm test` (all) or `npx vitest run <path>`.

## Docker & local cloud

- One parameterized [`Dockerfile`](Dockerfile): `--build-arg APP_NAME=<svc>`
  `--build-arg APP_PATH=<domain>/<svc>`. Runtime is `node bin/index.js` (the bundle).
- `npm run <service>.image` / `<service>.docker` build/run it.
- **LocalStack** (run the CDK against AWS-in-Docker): see [`cloud/README.md`](../cloud/README.md)
  and [`cloud/local/README.md`](../cloud/local/README.md).

---

## New-thing checklist (don't forget)

**New service:** `apps/<domain>/<service>` · `build: "rup-bundle"` · `@repo/build` devDep ·
root `<svc>` / `<svc>.image` / `<svc>.docker` scripts (with the right `APP_PATH`) ·
`npm install` · exact versions.

**New package:** `build` (or `tsc -p tsconfig.build.json` if it imports `@repo/*`) ·
add the alias to **`packages/tsconfig/base.json` paths** (one place — vitest + rup-bundle
auto-discover) · `npm install` · exact versions.
