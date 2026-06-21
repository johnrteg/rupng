# app — the web BFF (how-to)

The authenticated/public **backend-for-frontend**: bootstrap config, feature flags, notices, support
glue, UI aggregation, and web telemetry. This is the **how-to** (build / run / containerize / deploy);
[`SPECS.md`](./SPECS.md) is the design + requirements.

**Two roles**, selected by the `SERVICE_ROLE` env var (same code + image, different role + port — its
slot in the `APP` block of [`@repo/services` `Ports`](../../../packages/services/src/Ports.ts)):

| Role | `SERVICE_ROLE` | Port | What |
|---|---|---|---|
| **main** *(default)* | `main` | 8100 | authed BFF — UI aggregation, full flags, notices, support glue, ops |
| **public** | `public` | 8101 | public, edge-fronted — `/app/bootstrap`, public flags, rate-limited intake |

```
src/
  index.ts          # entry — picks the role from SERVICE_ROLE, runs it
  services/         # AppService (domain base) · AppMainService · AppPublicService
  AppModel.ts       # the app domain model
  CloudManifest.ts  # the AWS footprint (see "Cloud manifest" below)
```

---

## Build

```bash
npm run build       --workspace=app    # rup-bundle (esbuild) → a self-contained bin/index.js
npm run typecheck   --workspace=app    # tsc --noEmit
```

`build` produces one bundled CJS file (`bin/index.js`) that runs on plain `node` — all `@repo/*`
inlined, only `ajv`/AWS SDK kept external.

## Run as a node service (local dev)

```bash
npm run dev --workspace=app                        # main role on :8100 (tsx watch + reload)
SERVICE_ROLE=public npm run dev --workspace=app    # public role on :8101
PORT=9000 npm run dev --workspace=app              # override the port (env PORT always wins)
```

Health check (every role exposes it out of the box):

```bash
curl localhost:8100/health      # → {"ok":true}
```

---

## Build the Docker image

The image is the shared, parameterized **root [`Dockerfile`](../../../Dockerfile)** (turbo-prune →
esbuild bundle → slim `node:22-alpine`) — one image, both roles.

```bash
npm run docker:build --workspace=app
# = docker build --build-arg APP_NAME=app --build-arg APP_PATH=core/app -t rupapp-app:local ../../..
```

## Run as a Docker image

```bash
npm run docker:main   --workspace=app    # main   → :8100
npm run docker:public --workspace=app    # public → :8101
# both at once (+ LocalStack endpoint wiring), via docker-compose.yml:
npm run docker:up     --workspace=app
npm run docker:down   --workspace=app
```

Each role is the **same image** with a different `SERVICE_ROLE` + `PORT`. `curl localhost:8100/health`
to verify. See [`docker-compose.yml`](./docker-compose.yml) for the two-role + LocalStack setup.

---

## Cloud manifest & AWS

app declares its AWS footprint in [`src/CloudManifest.ts`](./src/CloudManifest.ts) — a typed
`ResourceManifest` (pure data, no CDK). The `/cloud` CDK app imports it (via the package's
`./manifest` subpath, registered in [`cloud/src/app.ts`](../../../cloud/src/app.ts)) and synthesizes a
stack: the two ECS **services** (main/public), the **jobs** (ticket / telemetry / cache-invalidation
Lambdas), the **notices** DynamoDB table, **AppConfig** (settings + feature flags), web **RUM**, a KMS
key, and the BFF **API Gateway** — with least-privilege IAM derived automatically.

You don't write CDK or IAM here — just the manifest. Resource ids are injected back as env vars the
service reads via the `CloudResolver` at boot (so the same code runs local / LocalStack / AWS). Full
manifest how-to: [`cloud/README.md`](../../../cloud/README.md).

## Run / deploy to LocalStack

The ECS task runs the **same image** built above (`SERVICE_ROLE` + `PORT` injected by the manifest).

```bash
cd ../../../cloud
npm run local:up                                   # start LocalStack + Kafka
npm run local:bootstrap                            # cdklocal bootstrap -c env=local
npx cdklocal deploy app-local -c env=local         # deploy just the app stack
# inspect first:  npx cdk synth app-local -c env=local
```

Deploy to real AWS is the same manifest via `npm run deploy:dev` (etc.) from `/cloud` — only the
injected env differs. See [`cloud/README.md`](../../../cloud/README.md).

---

## Commands cheat-sheet

| Command (`--workspace=app`) | Does |
|---|---|
| `npm run dev` | run `main` locally (tsx watch, :8100) |
| `SERVICE_ROLE=public npm run dev` | run `public` (:8101) |
| `npm run build` / `typecheck` | bundle to `bin/` / typecheck |
| `npm run docker:build` | build the image (`rupapp-app:local`) |
| `npm run docker:main` / `docker:public` | run a role as a container |
| `npm run docker:up` / `docker:down` | both roles + LocalStack wiring (compose) |
| *(from `/cloud`)* `npx cdklocal deploy app-local -c env=local` | deploy to LocalStack |
