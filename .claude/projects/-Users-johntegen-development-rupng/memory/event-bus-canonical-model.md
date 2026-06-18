---
name: event-bus-canonical-model
description: The canonical Kafka event-bus model — object+verb+typed payload in Events.Envelope (@repo/events)
metadata:
  type: project
---

Kafka (MSK) is the single inter-service bus, broadcast state-change (1 publisher → 0..N subscribers). The
canonical model (decided + implemented 2026-06-17):

**An event = `object` + `verb` + a typed `payload`, in `Events.Envelope`.** All in **`@repo/events`** — a
package created as the shared base both `@repo/endpoint` and `@repo/cloud-manifest` import (so the vocabulary,
verb set, and `Access` ladders have one home, no drift).
- `Events.Object` = `<service>.<noun>` (e.g. `media.asset`) — **IS the Kafka topic + the manifest
  `publishes`/`subscribes` binding**. One topic per entity, owned by the publisher, keyed by entity id.
- `Events.Verb` = created/updated/deleted/purged (universal). Subscriber switches on it within a topic.
- `Events.Action` = `${Object}.${Verb}` — a **derived template-literal type**, NOT a hand-maintained enum. The
  old per-service `*Action` enums + `*_META` maps were REMOVED (2026-06-17) so Object+Verb are the single source
  (no 2-place maintenance). Materialized on the envelope so a sink filters by action / object / verb.
- **Access + valid-action catalog** = ONE `ACCESS` map keyed by `Object` → `Verb` → `{minAccess, category}`
  (declared entries = valid actions; floors are per-verb; undeclared → ROOT fail-closed). `canConsume(role,
  action)` splits via `objectOf`/`verbOf`. `Verb` gained `ACCESSED` (read events like `auth.data.accessed`).
- `Events.Stream` (BEHAVIOR/ENGAGEMENT) = broad analytics ingestion streams (sole consumer: analytics).
- Payload: 1:1 `Object → PayloadFor<O>` interface, declared by the owning service, **fat by design**. Only
  `media.asset` defined as the example; others default to `unknown` until their owner declares them.
- `Events.Envelope`: `{ version, eventId, occurredAt, accountId, actor, object, verb, action, target, source,
  outcome, context?, data? }`; `Events.Of<O>` narrows to one object with required typed `data`.

**Topic grain is object/noun, NOT per-verb** — Kafka orders only within a topic-partition, so splitting verbs
would break per-entity ordering for state-sync consumers (caches/search/read-models). A created-only consumer
subscribes to the object topic and ignores other verbs (cheap in-process switch). Second class of notification
= point-to-point **SQS WorkQueue** (work/commands), NOT the event bus.

**Why:** supersedes the earlier untyped `Type.MessageEnvelope` (`{type,data}`) framing. `Access`+`Events` are
re-exported from `@repo/endpoint` for back-compat (existing `import {Access,Events} from "@repo/endpoint"` works).

**Universal envelope, end-to-end (done 2026-06-17):** `Events.Envelope` is the ONE body for Kafka
(inter-service), the WebSocket push frame (server→client), AND outbound webhooks. The Kafka facade
(`packages/services/src/aws/Kafka.ts`) now carries it: `publishEvent(envelope)` (topic = `envelope.object`,
key = `target.id`, routing fields in headers) / `subscribeEvents(group, object, …)` typed as `Events.Of<O>`,
plus `publishStream`/`subscribeStream` for analytics; raw `publish*`/`subscribe*` remain. Web
`WebsocketService.Message` = `Events.Envelope` (routes by `action`); `Type.MessageEnvelope` **removed** from
@repo/common (superseded). No real callers existed, so the facade API changed freely.

**Still pending:** per-object `PayloadFor<O>` (only `media.asset` defined); `/cloud` synth of Kafka
topics/bindings (no ServiceStack code for `publishes`/`subscribes` yet); `audit` is a stub (no package.json) so
AuditModel isn't compiled. Docs done: root SPECS, cloud/SPECS, MANIFEST.md, @repo/events README, endpoint/SPECS,
aws/SPECS, common/SPECS, services/README.
