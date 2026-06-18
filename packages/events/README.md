# @repo/events

The platform's **foundational event vocabulary + access model** — the shared base that both
[`@repo/endpoint`](../endpoint/SPECS.md) (the API/event contract) and
[`@repo/cloud-manifest`](../cloud-manifest/docs/MANIFEST.md) (the pub/sub topic bindings) build on, so the event
identity, the verb set, and the role ladders have **one home** and can't drift. Pure types/enums — no AWS, no
runtime — safe to import anywhere (including the web bundle and a synth-time manifest).

Overall design: [root SPECS → Events & messaging](../../docs/SPECS.md). Kafka publish mechanics:
[`@repo/services` aws/SPECS.md → Entity state-change events](../services/src/aws/SPECS.md).

## The model — an event is `object` + `verb` + typed `payload`

```ts
import { Events } from "@repo/events";

Events.Object.MEDIA_ASSET     // "media.asset"   — the ENTITY/NOUN == the Kafka topic == the pub/sub binding
Events.Verb.CREATED           // "created"        — the universal lifecycle verb
Events.actionOf(Events.Object.MEDIA_ASSET, Events.Verb.CREATED)   // "media.asset.created" — the full Action
```

* **`Object`** (`<service>.<noun>`) — *what* the event is about. **This is the Kafka topic and the manifest
  `publishes`/`subscribes` binding.** One topic per object, owned by the publishing service, keyed by entity id.
* **`Verb`** (`created | updated | deleted | purged | accessed`) — *how* it changed (`accessed` = a read/access
  event, not a lifecycle change). Universal; the discriminator a consumer switches on within a topic.
* **`Action`** = `` `${Object}.${Verb}` `` (`media.asset.created`) — the full event type, **materialized on the
  envelope** so a sink can filter by action, by object alone, or by verb alone (`actionOf`/`objectOf`/`verbOf`).
  Access is keyed by `Action` (a verb-level floor — e.g. `*.purged` can require a higher role than `*.created`).
* **`Stream`** (`BEHAVIOR` / `ENGAGEMENT`) — broad analytics ingestion streams (sole consumer: analytics). Not
  per-entity; the one place a "firehose" subscription is correct.

## The payload repository (object → representation)

Every object has one **representation** — and it's the **same shape** the entity has on the bus (`Of<O>.data`)
**and** in its API `GET` response. So it's defined **once**, in the central repository
[`src/payloads/<service>.ts`](src/payloads), and reused both ways — no drift between "what GET returns" and
"what the event carries." Payloads are **fat by design** (event-carried state transfer — consumers get the full
state, no call-back). Many objects may share one payload.

```ts
// src/payloads/media.ts — the canonical representation (pure types; imports only @repo/common)
import type { Type } from "@repo/common";
export interface MediaAsset {
  id: Type.ID; accountId: Type.ID; url: string; contentType: string; status: string; bytes: number;
}

// Events.ts — register it on the central map (singular `EventPayload`)
import type * as Payloads from "./payloads";
export interface EventPayload {
  [Object.MEDIA_ASSET]: Payloads.MediaAsset;
  // [Object.CONTACT_CONTACT]: Payloads.Contact, …
}

// anywhere:
Events.PayloadFor<Events.Object.MEDIA_ASSET>   // -> MediaAsset
Events.Of<Events.Object.MEDIA_ASSET>           // envelope with `data: MediaAsset`
```

**Reuse in API endpoints.** `@repo/endpoint` depends on `@repo/events`, so an endpoint def references the same
type for its `GET` response — one source of truth for the entity shape:

```ts
import { Payloads } from "@repo/events";
// the media GET endpoint's response type IS Payloads.MediaAsset (== Events.PayloadFor<Object.MEDIA_ASSET>)
```

## The envelope

`Events.Envelope` is the one wrapper every event rides in:

```ts
interface Envelope {
  version: string;            // payload schema version
  eventId: Type.ID;           // unique per occurrence — idempotency/dedup
  occurredAt: Type.ISODateTime;
  accountId: Type.ID;
  actor: Actor; target: Target; source: Source; outcome: Outcome;
  object: Object;             // == the topic
  verb:   Verb;
  action: Action;             // = `${object}.${verb}` (filter on any of the three)
  context?: Context;          // PII-light (ids/enums/counts)
  data?: unknown;             // the fat, typed payload
}
```

Use **`Events.Of<O>`** for a typed producer/consumer — the envelope narrowed to one object with a required,
typed `data`: `Events.Of<Events.Object.MEDIA_ASSET>` ⇒ `data: MediaAssetPayload`.

## Access — `canConsume`

`Access` (the role ladders) lives here too, because per-event access is part of the vocabulary. Access is
declared in **one `ACCESS` map keyed by `Object` → `Verb`** — which doubles as the catalog of **valid** actions
(the declared `(object, verb)` pairs). Floors are **per-verb** (`*.purged` can sit above `*.created`). Realtime
push, workflow triggers, outbound webhooks, and audit reads all gate on it; an undeclared pair fails closed (ROOT):

```ts
Events.canConsume(role, Events.actionOf(object, verb))   // may this role receive the event?
```

## Note

`Access` and `Events` are re-exported from `@repo/endpoint` for back-compat, so existing
`import { Access, Events } from "@repo/endpoint"` keeps working. New code may import from `@repo/events` directly.
