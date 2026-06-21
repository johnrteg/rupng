# /cloud — infrastructure how-to

The CDK app that turns each service's **manifest** into AWS resources. This is the **how-to**;
[`SPECS.md`](./SPECS.md) is the **design** (why manifests, the tenets, the topology).

**The model in one line:** a service declares *what AWS it needs* in a typed `CloudManifest`; `/cloud`
imports every manifest and synthesizes one stack per service — creating the resources, deriving
least-privilege IAM from declared access intent, and injecting resource identifiers back to the
service as env vars. **You never write CDK or IAM in a service.**

---

## Add a service to the cloud — 3 steps

### 1. Declare the manifest — `<service>/src/CloudManifest.ts`

Export a `ResourceManifest` from a **dedicated entry** (it imports only `@repo/cloud-manifest` — pure
data, no CDK, no runtime code — so synth pulls just this file). See
[`apps/core/app/src/CloudManifest.ts`](../apps/core/app/src/CloudManifest.ts) for a real example, or
[`packages/cloud-manifest/src/sample/widgetManifest.ts`](../packages/cloud-manifest/src/sample/widgetManifest.ts)
for an annotated reference.

```ts
import { ResourceManifest, AttrType, BillingMode, AccessIntent, ResourceKind } from "@repo/cloud-manifest";

export const manifest: ResourceManifest = {
  service: "myservice",
  owns: {
    tables: [ { key: "things", partitionKey: { name: "accountId", type: AttrType.STRING }, billingMode: BillingMode.ON_DEMAND } ],
    queues: [ { key: "work", dlq: true } ],
    jobs:   [ { key: "worker", handler: "jobs/worker.handler",
                triggers: [ { source: "queue", ref: { service: "myservice", kind: ResourceKind.QUEUE, key: "work", access: AccessIntent.CONSUME }, batchSize: 10 } ] } ],
    services: [ { key: "main", containerPort: 8000, healthCheckPath: "/health", environment: { SERVICE_ROLE: "main" } } ],
  },
  uses: [ { service: "media", kind: ResourceKind.BUCKET, key: "media", access: AccessIntent.READ } ],
};
export default manifest;
```

### 2. Expose it as the `./manifest` subpath — `<service>/package.json`

```jsonc
"exports": {
  ".":         "./bin/index.js",
  "./manifest": "./src/CloudManifest.ts"
}
```
…and make sure the service depends on `@repo/cloud-manifest`.

### 3. Register it — `cloud/src/app.ts` (two edits, marked with banner comments)

First add the service to `cloud/package.json` deps and run `npm install` (so the `myservice/manifest`
subpath resolves). Then, in [`src/app.ts`](./src/app.ts):

```ts
// STEP 1 of 2 — import the manifest (top of file, by the other manifest imports):
import { manifest as myservice } from "myservice/manifest";

// STEP 2 of 2 — add it to the `manifests` array:
const manifests: Array<ResourceManifest> = [
  appManifest,
  myservice,        // ← here
];
```
The loop below the array builds one `ServiceStack` per entry. Done — `cdk synth` now produces a
`myservice-<env>` stack (verify with `npx cdk list -c env=local`).

> The entry point lives at **`src/app.ts`**, not `bin/` — repo-wide `bin/` is gitignored build output,
> so the CDK entry would not be tracked there. `cdk.json` runs `npx tsx src/app.ts`.

---

## Manifest anatomy

> **Full field-by-field reference:** [`packages/cloud-manifest/docs/MANIFEST.md`](../packages/cloud-manifest/docs/MANIFEST.md)
> — every resource kind, the cross-cutting conventions (`ResourceKey`, `PerEnv`, `Sizing`), `uses`/access
> intent, Kafka bindings, and the runtime handoff, with examples. The summary below is the orientation.

| Section | What it declares |
|---|---|
| **`owns`** | resources this service creates — `services` (ECS), `jobs` (Lambda workers), `queues`, `tables`, `buckets`, `keys` (KMS), `appConfig`, `api`, `rum`, `caches`, `secrets`, `topics`, … (see [`Resources.ts`](../packages/cloud-manifest/src/Resources.ts)) |
| **`uses`** | resources **owned by another service** + an **access intent** (`read`/`write`/`consume`/`publish`/…). The CDK grants exactly that — **least-privilege IAM, derived, never hand-written** |
| **`publishes` / `subscribes`** | Kafka bindings against the shared cluster |
| **`tracing`** | enable X-Ray across the service's compute |

**Owner vs reference:** a resource is `owns`'d by exactly one service; anyone else `uses` it (a
`ResourceRef`). The CDK grants the consumer's role access to the owner's resource.

**Sizing is a 1..10 scale** (`sizing: { default: { cpu: 2, memory: 3 }, production: { cpu: 5, memory: 6 } }`)
— no instance types named anywhere. `PerEnv<T>` (`{ default, production, … }`) tunes per environment.

---

## The runtime handoff (don't discover resources at runtime)

The CDK injects each resource's physical id into the service's compute as an env var named by
`envVarName(kind, key)` (e.g. `QUEUE_WORK`, `TABLE_THINGS`), and publishes the same under
`/{env}/{service}/{kind}/{key}` in SSM. The service resolves **logical keys** at boot via the
`CloudResolver` from `@repo/cloud-manifest` — it never hardcodes a physical name:

```ts
const queueUrl = resolver.require(ResourceKind.QUEUE, "work");
```

So the same code runs locally, in LocalStack, and in real AWS — only the injected values differ.

---

## Run it — LocalStack (local "cloud")

LocalStack emulates AWS; `cdklocal` deploys to it. Env is **`local`** (account-agnostic, so synth
needs no credentials). See [`local/README.md`](./local/README.md).

```bash
npm run local:up          # start LocalStack + Kafka (Redpanda) — local/docker-compose.yml
npm run local:bootstrap   # cdklocal bootstrap -c env=local
npm run local:deploy      # cdklocal deploy  -c env=local   (or one stack: npx cdklocal deploy app-local -c env=local)
npm run local:down        # tear down (-v drops volumes)
```

A service's ECS task runs the **same image** you build locally (the root `Dockerfile`,
`--build-arg APP_NAME=<svc>`), selected by `SERVICE_ROLE` + `PORT` env.

## Deploy — real AWS

```bash
npm run synth:dev         # cdk synth -c env=dev   (inspect the template)
npm run diff:dev          # what changes
npm run deploy:dev        # cdk deploy --all -c env=dev
# staging / prod variants exist; prod requires approval
```
Account/region come from your AWS credentials/`CDK_DEFAULT_*`; the env is the CDK context `-c env=…`.

---

## Commands cheat-sheet

| Command | Does |
|---|---|
| `npx cdk list -c env=local` | list the stacks the app synthesizes |
| `npx cdk synth <stack> -c env=local` | emit one stack's template |
| `npm run local:up` / `local:down` | LocalStack + Kafka up / down |
| `npm run local:bootstrap` / `local:deploy` | bootstrap / deploy to LocalStack |
| `npm run deploy:dev` / `:staging` / `:prod` | deploy to real AWS |

---

## Gotchas

* **ECS image + Lambda code are placeholders at *synth*.** `ServiceStack` synths ECS with a registry
  placeholder image and missing Lambda handlers as an inline stub — so `cdk synth` needs **no Docker
  build**. The real image (root `Dockerfile`) and `jobs/*` bundles resolve at **deploy**.
* **SQS → Lambda `batchSize` ≤ 10** without a batching window (synth will reject larger).
* **`jobs` not `functions`.** A service's Lambda workers are declared under `owns.jobs` (the platform
  `Job` model); `services` is for long-running ECS.
* **No magic topic/action strings.** In `publishes`/`subscribes`, name topics with **`Topics.X`**
  (`@repo/cloud-manifest`) — never a literal; events are typed by **`Events.Action`** (`@repo/endpoint`),
  carried in an **`Events.Envelope`** body. Topic names live only in `Topics`, action types only in
  `Events`, so publisher and subscriber can't drift. (See SPECS.md → *Publishers & subscribers*.)
* **Escape hatch.** The manifest covers the routine ~90%. For the exotic, a service may also export raw
  CDK from `src/CloudManifest.cdk.ts` that `/cloud` composes alongside — manifest for routine, raw CDK
  for the rest. (See SPECS.md.)
* **One API / one WebSocket per service**; gateway routes are generated from the service's public
  `RestfulEndpoint` defs (see `lib/endpoints.ts`).
