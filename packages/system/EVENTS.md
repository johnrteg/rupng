# Event dictionary

The catalog of domain events services publish on the bus (Kafka). It's the contract a subscriber — a
peer service, an outbound webhook, and (once wired) the **web UI over websockets** — reads to know **what
exists to subscribe to** and **what shape the payload is**.

- **Source of truth for the vocabulary:** [`Events`](./src/Events.ts) — the `Object` (topics), `Verb`s,
  `Action`s, and the `Envelope`.
- **Payload models:** each event's `data` is a wire model from `@repo/api` (or an inline shape noted below).
- Keep this file in sync when you add/emit an event. Each row = one `<object>.<verb>` a service emits.

## The envelope (every event)

Every event is an `Events.Envelope` (see [`Events.ts`](./src/Events.ts)). The Kafka **topic is the
`object`** (`<service>.<noun>`) and the message **key is `target.id`**, so all of one entity's events stay
ordered on a partition. Key fields:

| field | meaning |
|---|---|
| `object` | the entity/topic — `Events.Object` (e.g. `media.asset`) |
| `verb` | `created` · `updated` · `deleted` · `purged` · `accessed` (`Events.Verb`) |
| `action` | `<object>.<verb>` — the subscribe key (e.g. `media.asset.created`), via `Events.actionOf` |
| `target` | `{ type, id }` — the entity (id = the Kafka key) |
| `accountId` | tenant scope — a subscriber filters to the acting account |
| `actor` | who caused it — `{ kind: user\|service, id }` |
| `data` | **the entity payload** — the TS model in the table below |
| `source` / `outcome` / `occurredAt` / `eventId` / `version` | provenance + dedupe |

## How the UI will subscribe (not yet wired)

The websocket layer isn't wired yet. When it is: the client subscribes by **`action`** (e.g.
`media.asset.*`), the server pushes the matching `Envelope`s for the client's `accountId`, and the client
uses `data` (the model below) to update its cache. The **same `Envelope` body** is what a peer service
consumes off Kafka and what an outbound webhook receives — one shape everywhere.

---

## Dictionary

Status: **live** = emitted today · **planned** = `Object` defined in `Events.ts` but not emitted yet.

### media  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `media.asset.created` | created | `Media.Asset` (`@repo/api`) | upload complete · duplicate | live |
| `media.asset.updated` | updated | `Media.Asset` | edit name/tags · generate variants · rescan | live |
| `media.asset.deleted` | deleted | `Media.Asset` | delete (soft) | live |

> Note: the async pipeline `status → ok` transition (variants + probed metadata ready) does **not** emit an
> `updated` yet — the request-path CRUD above does. Wiring a "ready" `updated` from the process/analyze step
> is a follow-up (needs the Kafka facade threaded into `MediaPipeline.Deps` + the Jobs).

### account  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `account.account.created` | created | `Account.Entity` (`@repo/api`) | personal-account provision · create sub-account | live |
| `account.account.updated` | updated | `Account.Entity` | edit account · owner transfer · sub-account status · billing settings · balance top-up | live |
| `account.member.created` | created | `Account.Member` | owner on provision · invite accepted (join) | live |
| `account.member.updated` | updated | `Account.Member` | role / status change | live |
| `account.member.deleted` | deleted | `{ userId }` | remove member | live |
| `account.invite.created` | created | `Account.Invite` | invite sent | live |
| `account.invite.updated` | updated | `Account.Invite` | resend · accepted | live |
| `account.invite.deleted` | deleted | `Account.Invite` (cancelled) | cancel invite | live |
| `account.account.deleted` / `.purged` | deleted/purged | `Account.Entity` | — | planned |
| `account.plan.*`, `account.invoice.*`, `account.block_list_entry.*` | — | — | — | planned |

> Note: `account.account.updated` covers billing-settings + balance changes (billing lives on the account
> row). A dedicated payment-method topic waits on the payment-method impls (skeletons today). The
> sub-account status change emits `updated` for the target sub-account only — cascaded descendants are a
> follow-up.

### auth  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `auth.user.created` | created | `User` (`@repo/api`) | registration verified | live |
| `auth.session.created` | created | `{ userId, username, at }` (inline) | login (password / MFA / passkey) | live |
| `auth.session.deleted` | deleted | `{ userId, username?, at }` (inline) | logout · revoke one · revoke all | live |
| `auth.passkey.created` | created | `{ credentialId, userId, createdAt }` (inline) | passkey enrolled | live |
| `auth.passkey.deleted` | deleted | `{ credentialId, userId }` (inline) | passkey removed | live |
| `auth.apikey.created` | created | `ApiKey.View` (`@repo/api`) | developer API key minted (secret NEVER on the bus) | live |
| `auth.apikey.deleted` | deleted | `{ keyId }` (inline) | developer API key revoked | live |
| `auth.user.updated` / `.deleted` | updated/deleted | `User` | — (password reset / profile / delete) | planned |
| `auth.mfa_challenge.*` | — | — | — | planned (TOTP enable/disable) |

> Note: auth is identity-centric — session/passkey events scope `accountId` to the acting account when
> known, else the userId (there's no account context at login/registration).

### app (BFF)  ⚪ consumer-only
The app BFF **consumes** `account.account` + `auth.user` to warm its read models; it owns no persisted CRUD
entity to publish yet (the notices entity isn't implemented). Nothing emitted. Kafka is disconnected cleanly
on shutdown. When notices land, emit `app.notice.created|updated|deleted` (add the `Object` topic + ACCESS first).

### everything else  ⚪ planned
`Object` topics are **defined** in [`Events.ts`](./src/Events.ts) for contact, campaign, workflow, email,
voice, texting, print, links, collab, marketplace, media variants, etc., but no emission is wired yet. Add a
row here when a service starts emitting.

---

## Adding an event (checklist)

1. **Topic** — ensure the entity has an `Events.Object` (`<service>.<noun>`) in [`Events.ts`](./src/Events.ts).
2. **Emit** — from the owning service, `kafka.publishEvent({ …, object, verb, action: Events.actionOf(object, verb), target: { type, id }, accountId, actor, data, source, outcome, sinks: [ Events.Sink.KAFKA ] })`.
   Best-effort: log a publish miss, never fail the request. (See `MediaService.publishAsset` for the pattern.)
3. **`data` = the wire model** — publish the entity's `@repo/api` model so subscribers share the contract.
4. **Document** — add the `<object>.<verb>` row above with its `data` model and emitting site.
