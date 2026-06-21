# RumbleUp Console

A local-only Electron + MUI desktop app for driving the service fleet. Built on `electron-vite`
(main / preload / renderer), TypeScript strict, React + MUI. Two top-level tabs:

- **Develop** — build, deploy to LocalStack, run, observe logs, health-check, and the in-app Claude + Jobs.
- **Monitor** — LocalStack observability: an architecture graph auto-derived from the deployed
  CloudFormation stacks, with per-resource details + CloudWatch log tail + `/_localstack/health` status.

## Run it

```bash
cd tools/console
npm install
npm run dev        # hot-reloading dev window
# or
npm run build && npm run preview   # production build + run
```

> Standalone project — `tools/*` is **not** an npm workspace, so Electron's heavy deps stay out of the
> monorepo. It still drives the repo it lives in (it auto-resolves the repo root from its own location).

## What it does

- **Service bar** — a tile per service (MUI icon + name + a running indicator). Discovered at runtime by
  scanning `apps/core/*`, with role/ports parsed live from `packages/cloud-manifest/src/Ports.ts` (the
  single source of truth). Spec-only services show as **planned** and light up once scaffolded. A **new
  service needs no console rebuild** — discovery, build, deploy, *and* ports/health all come from the
  filesystem; only a custom icon/label is an optional one-line catalog entry. The **Rescan** button
  (header) re-discovers without restarting the window.
  (`webproxy` and the `platform` pseudo-service are intentionally excluded.)
- **Staged pipeline** — per service, tick any subset of **Build → Docker image → Deploy** and **Run**.
  It executes in order and **halts on the first failure**; **Resume** re-runs but skips stages that
  already passed (no rolling back to the start). Each stage shows live status.
  - **Build** → `turbo run build --filter=./apps/core/<svc>`
  - **Docker image** → the service's `docker:build` script, else a generic root `docker build`
  - **Deploy** → `docker compose up --build -d` (then follows runtime logs), or `cdklocal deploy`
- **Console** — one tab per stream (Build / Docker / Deploy / Runtime) plus **Claude** and **Jobs**
  tabs, with substring filter, autoscroll, and clear. Compose deploys auto-follow container logs into
  the **Runtime** tab, which adds a **role filter** (e.g. `app-main` / `app-public`) — toggle one, both,
  or all, since one compose stream multiplexes every container's output.
- **Jobs / Lambdas** — a per-service Jobs tab lists the Lambda jobs found in `src/jobs/*.ts`, shows
  which are deployed to LocalStack, and lets you **Invoke** one with a JSON payload (jobs are
  queue/event-driven, so manual invoke is the test path) with the response + log tail inline. Deploy
  the Lambdas via the **Deploy** stage with the **cdklocal** target.
- **Health** — `GET :<port>/health` per role, with status, latency, and the response body.
- **LocalStack** — status chip + Up / Down / Refresh in the header (the shared dependency every local
  deploy targets).
- **Stop** — `Stop` kills all of a service's streams; `Compose down` stops & removes its containers.

## Claude Code integration (in-app)

Claude runs **inside the app** via `@anthropic-ai/claude-agent-sdk` — the main process calls the SDK's
`query()` with `cwd` set to the repo root, reusing your existing Claude Code auth (no API key needed).
A single **mode dropdown** on the Claude tab controls it:

| Mode | When it engages | What it may do |
|---|---|---|
| **Off** | never | — |
| **Diagnose on demand** | manual "Diagnose" button | reads logs + code, suggests fixes (no edits) |
| **Real-time diagnose** | auto, on a failed stage | read-only diagnosis |
| **Fix upon approval** | auto, on a failed stage | edit files / run commands — **each gated by Approve/Reject** in the UI |

It reads the same `.logs/<service>/<stream>.log` files the console writes, so it sees the exact
build/deploy output. The transcript is also persisted to `.logs/<service>/claude.log`.

## Monitor tab (LocalStack)

The graph is **auto-derived from CloudFormation**: the main process calls `describe-stacks` →
`describe-stack-resources` → `get-template` (via `awslocal`, falling back to `aws --endpoint-url`),
turns each resource into a node and each template reference (`Ref` / `Fn::GetAtt` / `DependsOn`) into
an edge. Low-level plumbing (IAM, security-group rules, route tables, task definitions, custom
resources, metadata) is filtered out so it reads as an architecture. The renderer lays it out with
**dagre** and renders pan/zoom SVG (scroll to zoom, drag to pan, reset button).

- **Click a node** → its CloudFormation type, logical/physical id, stack, and status; for Lambda/ECS,
  a **Tail CloudWatch logs** button shows recent events inline. **S3 buckets** are browsable
  (folder-style, click into prefixes); **API Gateway** nodes list their registered routes + endpoint.
- **Header strip** — `/_localstack/health` reachability + which AWS services are up, stack + resource counts.
- **Category filter** — the legend lives in the toolbar as toggle chips (with per-category counts);
  select one or more to filter the graph to those tiers (none selected = show all).
- **Architecture / Containers toggle** — switch from the graph to a live **Containers** table
  (`docker ps` + `docker stats`, refreshed every 4s) showing **CPU% and memory** per container. This
  is the only place the running app is visible with resource usage: the Develop-tab compose containers
  (`rupapp-app-*`) are host Docker (not CloudFormation), and the LocalStack **ECS tasks** also appear
  here — both tagged by kind. ECS-Service nodes in the graph additionally show live running/desired
  counts (LocalStack doesn't populate CloudWatch CPU/mem, so `docker stats` is the source).

All cloud access uses the **AWS SDK for JavaScript** (CloudFormation / CloudWatch (Logs + metrics) /
Lambda / S3 / API Gateway / ECS) — no `aws`/`awslocal` CLI required.

### Target: LocalStack or a real AWS account

A selector in the Monitor toolbar points the SDK clients at **LocalStack** (default) or a named
**`~/.aws` profile + region**. The whole Monitor surface works against either. Differences on a real
account:

- **Read-only** — a real account is observe-only: Lambda **Invoke** is disabled (you never invoke
  functions on AWS just to read stats), and the read-only chip shows in the toolbar.
- **Container CPU/memory** — `docker stats` only sees local containers, so on AWS the Containers view
  shows **ECS services** with CPU/Memory from **CloudWatch** (`AWS/ECS` utilization, polled every 20s
  vs 4s locally). The donuts + 30-minute charts render identically.
- Credentials come from the profile (SSO/keys you've already configured); nothing is entered or
  stored in the app.

## Architecture

```
src/
  shared/      types.ts (IPC contracts) · catalog.ts (labels/icons/ports — no MUI)
  main/        index.ts · registry.ts (discovery) · processManager.ts (spawn + pipeline)
               health.ts · logStore.ts (ring buffer + disk) · localstack.ts · claude.ts · ipc.ts
  preload/     index.ts (contextBridge — the only renderer→main surface; nodeIntegration off)
  renderer/    App.tsx · components/* · icons.tsx · theme.ts
```

The renderer has no Node access; it talks to main only through the typed `window.api` bridge.
