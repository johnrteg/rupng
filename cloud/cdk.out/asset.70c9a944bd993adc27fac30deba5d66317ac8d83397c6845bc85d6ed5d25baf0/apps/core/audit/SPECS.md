#
# Audit Service
#

# Objective

The platform's **single, immutable, action-level audit trail** — the durable record of **who did what, to what,
when, from where, and whether it succeeded** — across every service. It is the system of record that answers an
**auditor / regulator / incident responder**, not an SRE: logins and access grants, role and permission changes,
data exports, config changes, consent changes, money movement, admin actions, integration connect/disconnect.

It exists because **nearly every service's compliance posture claims "audited"** (SOC 2 CC7.2, ISO 27001 A.8.15,
GDPR Art 30) — and that claim needs **one owner** with the right non-functionals: **append-only / tamper-evident
storage, long (multi-year) retention, legal hold, and uniform schema** — none of which fit
[monitor](../monitor/SPECS.md)'s short-window ops telemetry or any business service's data model.

> **Two layers, deliberately split — do not conflate.**
> * **Change history** (field-level before/after diffs, e.g. [contact `contact-13`](../contact/SPECS.md)) stays
>   **co-located with each owning service** — it is **PII-dense** and bound to that service's tenancy + GDPR-forget
>   rules. Centralizing it would build a PII honeypot and a forget-coordination nightmare.
> * **This audit trail** (action-level events) is **central and PII-light** — it references `actorId` / `targetId`,
>   **never values** — *precisely so* it can be retained for years and survive a GDPR forget untouched.
> One holds PII and purges on forget; the other avoids PII and is immutable. That division is what makes both
> legally coherent.

# Role & boundaries

**Owns:**
* The **`AuditEvent` contract** — the uniform `{ actor, action, target, at, source, outcome, context }` envelope
  every service emits (a shared `Type` in `@repo/common`).
* **Ingestion + immutable storage** — consume the **audit SQS queue**, persist to an **append-only, WORM** store
  (no update / no delete API exists), with **tamper-evidence** (hash-chained / object-locked).
* **Retention + legal hold** — **configurable by environment** (default **dev 1 week / prod 1 year**); per-class
  longer tier where required; legal-hold freeze; defensible expiry.
* **Query + access** — tenant-scoped read for account admins (their own events) + a staff/auditor view; export
  for an audit/DSAR response.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **Emitting** the events | **every service**, via the shared **`Application.audit()`** base method (no service writes the store directly) |
| **Field-level change history** (before/after diffs) | the **owning service**, co-located ([contact `contact-13`](../contact/SPECS.md), …) — audit records *that* a change happened, not the field-by-field diff |
| **Ops telemetry** (metrics / logs / traces / resource state, ~2-week window) | **[monitor](../monitor/SPECS.md)** — health, not provenance |
| **Business metrics / reporting** | **analytics** |
| **Infra / control-plane audit** (who touched an AWS resource) | **AWS CloudTrail** (this is the *application / business-action* trail; CloudTrail is its infra peer) |
| **Identity / RBAC** (who the actor *is*, what they may read) | **[auth](../auth/specs/SPECS.md)** |

> **The audit store is write-once.** There is **no** mutate or delete endpoint — only append (via the SQS queue)
> and read. Even a platform root cannot edit history; expiry is policy-driven and logged.

# Core concepts

* **AuditEvent** — one immutable record: **actor** (who — `userId` / `serviceId` + real-actor & on-behalf
  context), **action** (verb — `user.login`, `contact.export`, `role.grant`, `consent.change`, `config.update`,
  `integration.connect`, `invoice.charge`), **target** (what — `{ type, id }`, by **id only**), **at** (server
  time), **source** (UI / API / job / webhook + IP/UA where relevant), **outcome** (success / failure / denied),
  and a small **PII-light `context`** (ids + non-PII facts; **never** field values or message content).
* **Emit, don't store** — a service calls `this.audit(event)`; the base **sends the event over SQS** (the audit
  queue + DLQ). The audit service is the **only** consumer that writes the store. *(SQS, not Kafka: audit is
  **fan-in to one sink** — point-to-point + durable + DLQ — not a multi-consumer / replay stream. SQS **FIFO**
  per `accountId` if strict per-tenant ordering is wanted; else standard + the idempotent, seq-stamping sink.)*
* **Immutability (WORM)** — append-only; tamper-evident (**per-tenant hash chain + S3 Object Lock**), so a
  later actor can't rewrite the past.
* **Retention tier** — each event class carries a retention class (security, compliance, financial,
  operational); **legal hold** overrides expiry.
* **Tenant scoping** — every event is account-scoped; an account admin reads **their** trail, staff/auditors read
  across (RBAC via auth).

# Architecture & flow

```
 EMIT (every service)
   Service / Job ── this.audit({ actor, action, target, outcome, context }) ──► SQS  audit queue (+ DLQ)
                     (PII-light; ids not values — enforced by the AuditEvent Type)

 SINK (this service)
   audit consumer ──► validate + stamp (seq / hash-chain) ──► append-only store
                          ├─ DynamoDB  (hot, queryable; PK accountId, SK at#seq)  — recent / query
                          └─ S3 Object Lock (WORM)  — durable archive + tamper-evidence + long retention
                                 retention tier + legal hold; no delete path

 READ
   account admin ──GET /audit/events?…──► their tenant's trail (RBAC)
   staff / auditor ─────────────────────► cross-tenant view + export (DSAR / SOC2 evidence)
```

* **One writer.** Services **emit**; only the audit consumer **writes**. No service — and no human — has an
  update/delete path to the trail.
* **Hot + cold.** Recent events live in **DynamoDB** (queryable); everything streams to **S3 Object Lock** for
  WORM durability + multi-year retention; query spans both (recent from DDB, archive via Athena over S3).
* **PII-light at the source.** The `AuditEvent` `Type` **structurally** discourages PII — `target` is an id, not
  a value; `context` is ids + enums. So the trail survives GDPR forget without redaction.

# What's audited (catalog — by emitter)

Representative events the shared `audit()` carries; the catalog grows by **declaration** (services add action
verbs). All are **PII-light** (ids, not values).

| Domain | Example actions | Emitter |
|---|---|---|
| **Auth / access** | `user.login` / `login.failed` / `mfa.challenge` · `session.revoke` · `role.grant` / `permission.change` · `apikey.issue` / `revoke` | [auth](../auth/specs/SPECS.md) |
| **Account / billing** | `account.create` / `close` · `plan.change` · `invoice.charge` · `block_list.add` | [account](../account/specs/SPECS.md) |
| **Contact** | `contact.export` · `contact.forget` · `consent.change` · `field_def.create` · `segment.archive` · *bulk ops* | [contact](../contact/SPECS.md) |
| **Messaging** | `campaign.launch` · `send.suppressed` (canSend denied) · `number.provision` (10DLC) | campaign / texting / email |
| **Integrations** | `integration.connect` / `disconnect` · `oauth.grant` / `revoke` · `zapier.action` | marketplace / zapier / hubspot |
| **Config / admin** | `config.update` · `feature_flag.change` · `staff.impersonate` · `data.access` (staff viewing tenant data) | every service |

> **Audit records *that* it happened; change-history records *how* the fields changed.** A `contact.update`
> audit event says "user U updated contact C at T (success)"; the **field-level `{before, after}` diff** lives in
> contact's own `change_history` (`contact-13`). Audit = provenance; change-history = the diff + revert.

# Immutability, retention & legal hold

* **Append-only / WORM** — no update or delete API; **S3 Object Lock** (compliance mode) on the archive **plus a
  required per-tenant hash chain** for tamper-evidence (each record chains the prior record's hash, so any gap /
  edit / reorder is detectable on verify-on-read).
* **Retention — configurable by environment** (AppConfig): default **dev = 1 week**, **prod = 1 year** (matching
  the auth security-audit decision); a specific event class may be set to a **longer tier** where a legal /
  financial obligation requires it. **Defensible, logged expiry** — end-of-life deletion is itself a policy
  action, not an ad-hoc edit.
* **Legal hold** — freeze expiry for a scope (account / subject / time-range) during litigation or
  investigation; overrides the retention tier until released.
* **Residency** — the trail is **jurisdiction-pinned** like all data (EU tenants' audit stays in the EU
  account/region — the platform [residency = jurisdiction](../../../docs/SPECS.md) rule).

# Relationship to change history

| | **Change history** | **Audit trail (this service)** |
|---|---|---|
| Granularity | field-level `{ before, after }` | action / event |
| Data owner | the **owning service** (co-located) | **central audit** service |
| Storage | with the entity (e.g. `change_history`) | append-only **WORM** (DDB + S3 Object Lock) |
| PII | **holds** prior values; **purges on forget** | **PII-light** (ids); **survives forget** |
| Retention | with the entity | long / compliance; immutable |
| Consumer | "revert this field" / "who changed this field" | auditor / regulator / incident responder |
| Mechanism | `ChangeHistory` lib + the service's **Stream job** | `Application.audit()` → **SQS** → this service |

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`AuditService extends Service`) and a **domain Job base** (`AuditJob extends Job`) hold the
**shared domain code** — the **`AuditEvent` model + validation**, the **hot-DDB + S3 / Athena query** clients, the
**hash-chain** stamp/verify, the **retention policy**, and **RBAC scoping**. Audit is shaped by its one hard rule:
**a single writer, read-only everywhere else.** The **emit side is *not* part of this service** — every Service
and Job already carries the platform **`Application.audit()`** base method (→ SQS); audit only **consumes**.

```
Application   (every Service & Job already has Application.audit() → SQS — the EMIT side, platform-wide; not audit's code)
├── Service (Fastify, long-running — ECS)
│     └── AuditService            (domain base — AuditEvent model · hot-DDB + S3/Athena query clients · hash-chain verify · retention policy · RBAC; not deployed alone)
│           └── AuditQueryService  (READ + admin ONLY: tenant + staff/auditor query · export (DSAR/SOC2) · legal-hold · config — NO event-write endpoint by design)
└── Job (Lambda, event-driven)
      └── AuditJob                 (domain base — AuditEvent validate · seq + hash-chain · DDB + S3 Object Lock clients · idempotency)
            ├── AuditSinkJob        (SQS — THE SINGLE WRITER: validate → stamp seq + hash-chain → append to hot DDB; idempotent dedupe by event id)
            ├── AuditArchiveJob     (DDB Streams — mirror closed records to S3 Object Lock (WORM, Parquet) for durable retention + Athena)
            └── AuditRetentionJob   (EventBridge — defensible, LOGGED expiry by tier; legal hold overrides; expiry is itself an audited action)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`AuditService`** | `Service` | **Domain base** — `AuditEvent` model · hot-DDB + S3/Athena query clients · hash-chain verify · retention policy · RBAC; **not deployed alone**. |
| **`AuditQueryService`** | `AuditService` | **Read + admin ONLY** — tenant-scoped query (account admin) + cross-tenant (staff / auditor), **export** (DSAR / SOC 2 evidence), **legal-hold** place/release, config, health. **No event-write endpoint** — writes arrive **only** via SQS (`audit-2.2`). Reads of the trail are themselves audited (`audit-5.2`). |

**Jobs (Lambda, event-driven)** — each extends `AuditJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`AuditSinkJob`** | SQS (the audit queue) | **THE single writer** — validate the `AuditEvent`, **stamp `seq` + hash-chain** (tamper-evidence), **append to hot DDB**; idempotent dedupe by event id. No service (or human) writes the store | audit-2.1 / 2.2 / 3.2 |
| **`AuditArchiveJob`** | DynamoDB Streams | Mirror records to **S3 Object Lock** (WORM, Parquet — avoids per-event small files) for **durable long-retention + Athena** historical query | audit-2.3 / 3.1 |
| **`AuditRetentionJob`** | EventBridge (scheduled) | **Defensible, logged expiry** by retention tier; **legal hold overrides**; end-of-life deletion is itself a logged policy action | audit-4.1 / 4.2 |

> **Shared modules (not deployables).** The **`AuditEvent` `Type`** lives in `@repo/common` (shared by **every
> emitter** + this sink), and the **`Application.audit()`** emitter lives on the platform `Application` base — so
> the *producer* side is platform-wide, **not** owned here; audit owns only the **sink + store + read**. The
> **hash-chain** stamp/verify is shared by `AuditSinkJob` (stamp) + `AuditQueryService` (verify-on-read).

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — the **audit ingestion queue** (the only write source; FIFO if per-tenant ordering needed).
* **DynamoDB** — hot/queryable recent trail (`PK accountId`, `SK at#seq`); no-delete IAM.
* **S3 (Object Lock / WORM)** — durable archive + tamper-evidence + long retention; **Athena** for archive query.
* **KMS** — encryption at rest.
* **EventBridge Scheduler** — retention-expiry sweep (policy-driven, logged).

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Dynamo, S3, Kms) — incl. the shared **`Application.audit()`** emitter every service
  uses; `@repo/endpoint` (`Access`), `@repo/common` (the **`AuditEvent` `Type`**).
* Consumed/related: **[auth](../auth/specs/SPECS.md)** (RBAC on read; actor identity), **all services** (emitters),
  **[monitor](../monitor/SPECS.md)** (peer — telemetry, not provenance), **AWS CloudTrail** (infra peer).

# Compliance & standards mapping

How **this audit service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, and **CCPA/CPRA**. Audit is the **evidence layer** other services' "audited" claims
rely on — its dominant controls are **immutability / tamper-evidence**, **retention + legal hold**, **PII
minimization**, and **scoped read access**. **No PCI / PHI** content (PII-light by design).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Audit control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | |
|---|---|---|---|---|---|---|
| **Immutable, tamper-evident trail** — append-only; S3 Object Lock + hash chain; no update/delete path | A08 | A.8.15 / A.5.28 | CC7.2 / CC7.3 | Art 5(2) / 30 | ➖ | ✅ |
| **Centralized logging of security events** — logins, access, role/permission, config, exports | A09 | A.8.15 / A.8.16 | CC7.2 | Art 32 | §1798.81.5 | ✅ |
| **Retention + legal hold** — tiered, defensible expiry; litigation freeze | A09 | A.5.33 / A.8.15 | CC7.2 | Art 5(1)(e) | ➖ | ✅ |
| **PII minimization** — ids not values; survives GDPR forget (no PII to erase) | A09 | A.8.10 / A.8.11 | (Privacy) | Art 5(1)(c) / 17 | §1798.100 | ✅ |
| **Scoped read access** — tenant-scoped admin view; staff/auditor cross-view via RBAC; reads are themselves audited | A01 | A.5.15 / A.8.3 | CC6.1 | Art 32 | §1798.100 | ✅ |
| **Residency** — audit trail jurisdiction-pinned (EU stays EU) | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ✅ |
| **Encryption** — TLS in transit, SSE-KMS at rest | A02 | A.8.24 | CC6.1 | Art 32 | ➖ | ✅ |

> **Design-intent mapping** — how the service is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Two layers — DECIDED.** Action-level **audit trail = this central service** (PII-light, immutable);
   field-level **change history = co-located** with the owning service (PII-dense, purges on forget). They do not
   merge.
2. ✅ **Emit-don't-store — DECIDED.** Services call the shared **`Application.audit()`**; only this service writes
   the store. No service (or human) gets an update/delete path.
3. ✅ **PII-light by contract — DECIDED.** The `AuditEvent` `Type` carries **ids, not values** — so the trail
   survives a GDPR forget without redaction (the reason it can be retained for years).
4. ✅ **Immutability — DECIDED: WORM.** S3 Object Lock **+ a required per-tenant hash chain** (#6);
   env-configurable retention (#7) + legal hold; expiry is a logged policy action.
5. ✅ **Not monitor, not app — DECIDED.** Monitor is ~2-week ops telemetry (defers compliance retention); audit
   is multi-year immutable provenance. Distinct service.
6. ✅ **Tamper-evidence — DECIDED: hash chain (+ S3 Object Lock).** The trail is a **per-tenant hash chain** —
   each record chains the prior record's hash, so **any gap, edit, or reorder is detectable** on verify-on-read —
   **in addition to** S3 Object Lock (WORM) on the archive. Not "Object Lock alone"; the hash chain is **required**
   (`audit-3.2`).
7. ✅ **Retention — DECIDED: configurable by environment (dev 1 week / prod 1 year).** Retention is
   **configurable per environment** (AppConfig) — default **dev = 1 week**, **prod = 1 year** — matching the auth
   security-audit decision (`auth-19.5`). A specific event class may be configured to a **longer tier** where a
   legal / financial obligation requires it; expiry is always **defensible + logged** + legal-hold-aware
   (`audit-4.1`).

# Requirements (traceable register)

The traceable register for the **audit service** (IDs **`audit-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** audit owns the **event contract + immutable store +
retention + query**; **emission** is the shared base method (every service); **change history** is the owning
service; **identity/RBAC** is auth; **infra audit** is CloudTrail; **ops telemetry** is monitor.

## audit-1.0 Event contract & emission — A
- **audit-1.1** **`AuditEvent` `Type`** in `@repo/common` — `{ actor (id + real-actor/on-behalf), action, target {type,id}, at, source, outcome, context }`; **PII-light** (ids, not values) — A
- **audit-1.2** **Shared `Application.audit()`** base method — every Service **and** Job emits uniformly; **sends the event over SQS** (audit queue + DLQ) to this service — A
- **audit-1.3** **Action-verb catalog** grows by **declaration**; covers auth/access, account/billing, contact, messaging, integrations, config/admin (incl. `staff.impersonate`, `data.access`) — A

## audit-2.0 Ingestion & immutable storage — A
- **audit-2.1** **Single-writer sink** — the audit consumer is the **only** writer; no service writes the store directly — A
- **audit-2.2** **Append-only** — **no update / no delete API** exists (even for root); writes are stamped with `seq` — A
- **audit-2.3** **Hot + cold** — DynamoDB (recent, queryable; `PK accountId` / `SK at#seq`) + **S3 Object Lock** (WORM archive); query spans both (Athena over archive) — A
- **audit-2.4** **Encryption** — SSE-KMS at rest, TLS in transit — A

## audit-3.0 Tamper-evidence — B
- **audit-3.1** **S3 Object Lock (compliance mode)** on the archive — write-once, time-locked — B
- **audit-3.2** **Per-tenant hash chain (required)** — each record chains the prior record's hash; any gap / edit / reorder is **detectable** on verify-on-read (in addition to S3 Object Lock) *(gap #6)* — B

## audit-4.0 Retention & legal hold — B
- **audit-4.1** **Retention — configurable by environment** (default **dev 1 week / prod 1 year**, AppConfig; matches `auth-19.5`); a class may be set to a **longer tier** where legal/financial requires; **defensible, logged** expiry *(gap #7)* — B
- **audit-4.2** **Legal hold** — freeze expiry for an account / subject / time-range; overrides tier until released — B
- **audit-4.3** **Residency** — trail jurisdiction-pinned (EU stays EU) — A

## audit-5.0 Query & access — A
- **audit-5.1** **Tenant-scoped read** — an account admin reads **their** trail; **staff/auditor** cross-tenant view (RBAC via auth) — A
- **audit-5.2** **Reads are themselves audited** (access-to-the-audit-trail is an audited action) — B
- **audit-5.3** **Export** — filtered export for DSAR / SOC 2 evidence — B

## audit-6.0 Infra — A
- **audit-6.1** **SQS (+ DLQ)** (audit ingest) · **DynamoDB** (hot) · **S3 Object Lock** (WORM) + **Athena** · **KMS** · **EventBridge** (expiry sweep) — A

## audit-7.0 Service & Job topology — B
- **audit-7.1** **Domain bases** — `AuditService extends Service` + `AuditJob extends Job` hold the shared code (`AuditEvent` model · hot-DDB + S3/Athena clients · hash-chain · retention policy · RBAC); **concrete roles extend the domain base** — B
- **audit-7.2** **`AuditQueryService`** — **read + admin ONLY** (query · export · legal-hold · config); **no event-write endpoint** — A
- **audit-7.3** **Jobs extend `AuditJob`** — `AuditSinkJob` / `AuditArchiveJob` / `AuditRetentionJob` — A
- **audit-7.4** **`AuditSinkJob` = the single writer** — validate → stamp `seq` + hash-chain → append to hot DDB; idempotent; no other writer exists — A
- **audit-7.5** **Emit side is platform-wide** — `Application.audit()` (→ SQS) lives on the `Application` base used by every service; audit owns only the **sink + store + read**, not the emitter — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/audit/*`.
**Writes are queue-only** (`Application.audit()` → SQS); the HTTP surface is **read + admin** only — there is
**no POST/PUT/DELETE for events**. **Access column:** **`-`** internal · account ladder `USER`<`ACCOUNT` ·
staff ladder `SUPPORT`<`APPLICATION`<`ROOT`.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/audit/events` | Query the tenant's trail (filters: actor, action, target, time-range; paged) | ACCOUNT | audit-5.1 |
| GET | `/audit/events/{id}` | A single audit event | ACCOUNT | audit-5.1 |
| GET | `/audit/events/staff` | Cross-tenant view (staff / auditor) | APPLICATION | audit-5.1 |
| POST | `/audit/export` | Filtered export (DSAR / SOC 2 evidence) — audited | ACCOUNT | audit-5.3 |
| POST | `/audit/legal-hold` | Place / release a legal hold on a scope | ROOT | audit-4.2 |
| GET, PUT | `/audit/config` | Retention tiers + tamper-evidence settings (AppConfig) | ROOT | audit-4.1 |
| GET | `/audit/health` | Liveness / readiness (consumer + sink) | - | audit-6.1 |

> **No event-write endpoint by design** — events arrive **only** via the audit **SQS queue** from
> `Application.audit()`. The trail is write-once; the API is read + retention-admin.

# eof
