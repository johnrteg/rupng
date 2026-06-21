# `@repo/cloud-manifest`

**The dictionary a service uses to ask for cloud infrastructure — without knowing any AWS.** A service
declares *what it needs* in a typed `ResourceManifest`; the [`/cloud`](../../cloud/SPECS.md) CDK app turns that
into AWS resources, derives least-privilege IAM, and injects the resulting identifiers back as env vars.

This is the package's **documentation index**. The docs live in [`docs/`](docs/); the types live in [`src/`](src).

---

## Documentation

| Doc | What it is |
|---|---|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | **Start here** — what problem the package solves, the model (declare *what*, not *how*), and how the pieces fit. |
| [docs/MANIFEST.md](docs/MANIFEST.md) | **Manifest structure reference** — every resource kind in `owns`, the cross-cutting conventions (`ResourceKey`, `PerEnv`, `Sizing`), `uses` + access intent, Kafka bindings, and the runtime handoff. |
| [docs/DYNAMODB.md](docs/DYNAMODB.md) | **DynamoDB tables** — how a TS entity interface maps to a `TableSpec` (keys are the only overlap), the typed `keyOf`/`ttlOf` binding, multi-tenant keys, sorting & paging. |

## Source (`src/`)

| Module | Holds |
|---|---|
| [`Manifest.ts`](src/Manifest.ts) | `ResourceManifest` (a service's footprint) + `PlatformManifest` (shared infra) |
| [`Resources.ts`](src/Resources.ts) | the per-resource specs (`TableSpec`, `QueueSpec`, `JobSpec`, `ServiceSpec`, `AutoScalingSpec`, …) |
| [`Common.ts`](src/Common.ts) | `ResourceKey` · `ResourceRef` · `ResourceKind` · `AccessIntent` · `Tags` |
| [`Environment.ts`](src/Environment.ts) | `Environment` + `PerEnv<T>` (+ `forEnv`) |
| [`Sizing.ts`](src/Sizing.ts) | the 1..10 `Sizing` scale |
| [`Naming.ts`](src/Naming.ts) | `physicalName` / `ssmPath` / `envVarName` — used by both `/cloud` and the runtime resolver |
| [`Resolver.ts`](src/Resolver.ts) | `CloudResolver` — resolve logical keys → physical ids at runtime |
| [`TableKeys.ts`](src/TableKeys.ts) | `keyOf<E>()` / `ttlOf<E>()` — bind a `TableSpec`'s keys to the entity interface |
| [`Ports.ts`](src/Ports.ts) | the service → local-port registry (`Ports.APP.MAIN`, …) |

Consumed by every service's `src/CloudManifest.ts` (pure data — imports only this package) and by the
[`/cloud`](../../cloud/README.md) CDK app at synth.
