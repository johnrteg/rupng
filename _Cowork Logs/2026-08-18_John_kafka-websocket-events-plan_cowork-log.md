# Cowork Session Log

## Header
- User: John Tegen (jtegen@rumbleup.com)
- Date/time started: 2026-08-18
- Task (verbatim): "how about hooking up web sockets to browser from kafka generated events from different services. For now, just pipe events to app model and console them out. do not take action based on the type of event being generated. events should be filtered based on the account the user is in. if you need to develop this in phases, that is fine."
- Connectors/folder grants available this session: local filesystem access to /Users/johntegen/development/rupng (git repo), Bash, Read/Edit/Write tools, Agent/Workflow orchestration tools. No external connectors (Slack/email/etc.) used.

## Actions
- Created `_Cowork Logs/` directory in working folder (did not exist) — required by org logging policy.
- Created this log file.
- Spawned an Explore subagent (read-only) to research: Kafka publish/consume patterns (`packages/system/src/Events.ts`, `packages/services/src/aws/Kafka.ts`, `apps/core/auth/src/services/AuthMainService.ts`), web app appmodel/websocket infra (`apps/core/web/src/model/AppModel.ts`, `.../service/WebsocketService.ts`, `.../service/PubSubService.ts`, `.../service/AccountService.ts`), and existing realtime-gateway infra (`apps/core/realtime/SPECS.md`, `packages/cloud-manifest/src/Resources.ts`, `cloud/src/lib/ServiceStack.ts`). No files modified — read-only research.
- Key findings: a `realtime` service is already fully spec'd (`apps/core/realtime/SPECS.md`) but not implemented (no package.json/src). A web client (`WebsocketService.ts`) and pub/sub bus already exist client-side but are dead code today — `AccountService.applyCurrent()` never calls `ws.setAccountId(...)`, and no backend service provisions a `webSocketApi` yet. `Events.Envelope` already carries `accountId` for filtering. Presented a phased implementation plan to the user for confirmation (see conversation) before touching any files.

- User approved the phased plan ("yes"). Implemented Phase 1 end-to-end:
  - `packages/system/src/Register.ts` — added `REALTIME = "realtime"` to `Register.Service`.
  - New files: `apps/core/realtime/package.json`, `tsconfig.json`, `src/CloudManifest.ts`, `src/index.ts`, `src/services/RealtimeService.ts`.
  - `RealtimeService` (single MAIN role, port 8310): on boot it (1) attaches a raw WebSocket bridge directly on the Fastify container's HTTP server (`upgrade` event), accepting `/account/ws?cid=<accountId>` connections and holding them in an in-process `Map<accountId, Set<WebSocket>>`; (2) subscribes to the ENTIRE `Events.Object` vocabulary via `kafka.subscribeEvents` (no push-set filtering — per the user's explicit "do not take action based on type" instruction) and forwards every envelope, unmodified, only to the sockets registered under that envelope's `accountId` (fail-closed: an envelope with no `accountId` is dropped + logged).
  - `apps/core/webproxy/src/config/local.json` — repointed the stub `"local"` ws upstream (previously a placeholder aimed at the proxy's own port) to `"realtime"` at `http://localhost:8310`.
  - `apps/core/web/src/model/service/AccountService.ts` — `applyCurrent()` now calls `appmodel.ws.setAccountId(account.accountId)` so the existing (previously dead-code) `WebsocketService` client actually opens/reconnects on account switch.
  - `apps/core/web/src/model/service/WebsocketService.ts` — inbound frames are now `console.log`'d verbatim (in addition to the existing generic `pubsub.publish` by `action`, which nothing yet subscribes to) — satisfies "pipe events to app model and console them out."
  - Ran `npm install` at repo root — added the new `realtime` workspace to `package-lock.json`.
  - Typechecked `apps/core/realtime`, `packages/system`, `apps/core/web`, `apps/core/webproxy` via `npx tsc --noEmit` (ignoring the documented cross-package `TS6059` rootDir noise) — no real errors.
  - Smoke-tested `apps/core/realtime` directly with `npx tsx src/index.ts`: booted cleanly, opened two WebSocket connections under different `accountId`s (`acct-A`, `acct-B`), confirmed the connection registry tracked each independently and cleaned up on close (via server logs). Did not test the Kafka→push path live (no local Kafka broker running this session; the consumer correctly logs "skipped — no Kafka brokers configured" and no-ops, matching the existing best-effort pattern used by `auth`'s Kafka consumer).

## Rationale
- Log file created first, before any research/edits, per org instruction #1 (session logging required before doing anything else).
- Used a read-only Explore agent instead of editing anything, since org instruction #2 requires showing a plan before making changes to files; presented the phased plan and got explicit "yes" before any file was touched.
- **Deliberate scope simplification vs. `apps/core/realtime/SPECS.md`:** the SPECS document describes a full production design (DynamoDB connection registry, real AWS API Gateway WebSocket API + Lambda `$connect`/`$disconnect`, Redis Streams outbox, per-connection token-bucket pacing, AppConfig-driven push-set, presence). Building that in full was far beyond "for now, just pipe events... and console them out." Phase 1 instead uses an in-process connection map and terminates the WebSocket directly on the Fargate container (dev-only path) — this only works correctly with a SINGLE running instance of the service. Scaling to multiple instances requires the real registry + AGW + Lambda design already captured in SPECS.md — a clearly separate, later phase, consistent with the user's "if you need to develop this in phases, that is fine."

## Anomalies
- None. No PII, credentials, or unexpected instructions encountered in any file read during this session.

## Footer
- Output files: this log file; `packages/system/src/Register.ts`; `apps/core/realtime/{package.json,tsconfig.json,src/CloudManifest.ts,src/index.ts,src/services/RealtimeService.ts}`; `apps/core/webproxy/src/config/local.json`; `apps/core/web/src/model/service/{AccountService.ts,WebsocketService.ts}`; `package-lock.json` (new workspace entry).
- Session end: 2026-08-20 (local time, per environment clock).
