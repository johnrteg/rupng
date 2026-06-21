#
# Dropbox integration
#

# Objective

Connect an **account's Dropbox** as a **storage destination** — the place the platform **delivers a generated
artifact**: a [report](../../core/report/SPECS.md) export (CSV / PDF / Excel / JSON) or a contact export, dropped
into a designated folder, with the **file id** (and an optional **shared link**) returned. *"My month-end
delivery-summary CSV lands in `/RumbleUp/Reports/` every Monday."* This is **mainly outbound file delivery** —
Dropbox is the **sink**, the platform's report/export factory is the **source**.

This is the **storage end of the report delivery path**: [report](../../core/report/SPECS.md) generates an
artifact to S3 and publishes **`report.completed`**; the **account's [workflow](../../core/workflow/SPECS.md)**
consumes it and routes the deliverable to a destination — and *this connector is one of those destinations*
(`report-7.2`). It is also a plain workflow **`integration-action`** node — **"save file to folder"** — any flow
can call (`workflow-6.2`).

A **secondary, later** direction is **inbound**: import a **CSV of contacts** from a watched / selected folder
(a **"new file in folder" trigger** or an on-demand pull) → hand to the [contact](../../core/contact/SPECS.md)
import. Imported files may carry **PII**; handled under *Files & PII* below.

This is **not a new data plane.** Dropbox is **account-connected**, so it lives under
**[marketplace](../../core/marketplace/SPECS.md)** governance — **per-account OAuth**, the **Zapier governance
pattern** ([zapier](../zapier/SPECS.md): accept-to-enable · `dataJurisdiction` cross-border gate · metering ·
egress feature-flag × permission). **The account is the controller.** Outbound delivery rides the shared
connector/dispatch framework (throttle · retry · DLQ); secrets ride the **marketplace vault**. Its sibling is
**[Google Drive](../google-drive/SPECS.md)** — same archetype, one adapter each behind the marketplace connector
pattern.

# Role & boundaries

**Owns:**
* The **Dropbox delivery contract** — given an artifact reference (the report's S3 `outputKey`) + a target
  **folder path** + options (overwrite / autorename, make-shared-link), **upload** the file and return
  `{ fileId, path, rev, sharedLink? }`.
* **Upload mechanics** — small files via **`/files/upload`**; large files via **chunked / resumable upload
  sessions** (`upload_session/start` → `append_v2` → `finish`), with **resume** on interruption.
* **Folder + shared-link operations** — list / create a folder path (`/files/create_folder_v2`), create a
  shared link (`/sharing/create_shared_link_with_settings`) with the account's chosen visibility.
* **Inbound pull** *(secondary)* — list a watched folder, **download** a selected CSV, and hand it to the
  contact import; derive the **"new file in folder"** trigger.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **The artifact itself** (generation, S3 storage, `report.completed`) | **[report](../../core/report/SPECS.md)** |
| **What to deliver where / when** (the trigger graph) | **[workflow](../../core/workflow/SPECS.md)** (this connector is an `integration-action`; the new-file trigger is a trigger node) |
| **Contact identity + the import pipeline** (validate · dedupe · consent) | **[contact](../../core/contact/SPECS.md)** |
| **Pacing / retry / DLQ / fair-share** of outbound uploads | the shared **connector / dispatch framework** |
| **Secrets** (per-account OAuth tokens) | **marketplace vault** (Secrets Manager + KMS, reference-only) |
| **Failure / backpressure alerting** | **[monitor](../../core/monitor/SPECS.md)** |

> **No PII reach-down; the account is controller.** Dropbox is the **account's own** storage. Delivering a report
> there is **egress to account-controlled storage**. When a contact is forgotten, erasure here = **stop-delivering
> + disclose**, not reach-in-delete (the [egress erasure boundary](../../../docs/SPECS.md)) — see *Files & PII*.

# Core concepts

* **Connection (installation)** — an account's connected Dropbox: the OAuth grant (vaulted in marketplace), the
  account's chosen **root** / default folder path, and connection health. Lifecycle is the marketplace
  `enable → connect → active → pause → remove` (+ **auto-pause** on account-inactive / revoked token).
* **Delivery** — one outbound **save-file-to-folder**: an artifact reference (S3 `outputKey` + format) + a target
  **folder path** + options → an upload → `{ fileId, path, rev, sharedLink? }` returned to the caller (the
  workflow instance / the report-delivery path). **Idempotent** — keyed by `(accountId, outputKey, path)` so a
  redelivery doesn't double-write (overwrite-by-rev or autorename per config).
* **Upload session** — Dropbox caps a single `/files/upload` at a size limit; larger artifacts use a **resumable
  upload session** (start → append chunks → finish) that **survives interruption** and resumes from the last
  committed offset — the storage analogue of the throttle/requeue pattern.
* **Folder path** — Dropbox addresses files by **path** (`/RumbleUp/Reports/2026-06.csv`), not an opaque folder
  id (contrast [Google Drive](../google-drive/SPECS.md), which uses folder **ids**). The connector ensures the
  path exists (create-folder, idempotent) before upload.
* **Shared link** — an optional **`create_shared_link_with_settings`** call returns a shareable URL with the
  account's chosen visibility / expiry; returned alongside the file id so a delivery can notify a recipient.
* **New-file trigger** *(secondary)* — a Dropbox folder gains a file → a normalized **`dropbox.file.created`**
  event (via the Dropbox **webhook** + a cursor list, or a poll-and-dedupe), feeding a contact-import workflow.

# Architecture & flow

```
 OUTBOUND DELIVERY  (the headline)
   report.completed (Kafka)  ──► ACCOUNT WORKFLOW ── routes delivery
        │  OR a workflow integration-action ("save file to folder")
        └─► dropbox CONNECTOR  (MarketplaceActionJob)
                 • resolve fresh token (marketplace vault reference)  • ensure folder path exists
                 • read artifact from S3 (the report outputKey)
                 └─► UPLOAD to Dropbox API v2
                          small  → /files/upload
                          large  → upload_session/start → append_v2(chunks) → finish   (RESUMABLE)
                          429/5xx → computed-delay requeue (NOT hammer) → retry → DLQ → auto-pause + alert
                     └─► optional /sharing/create_shared_link_with_settings
                          └─► return { fileId, path, rev, sharedLink? } to the caller (workflow / report path)

 INBOUND PULL  (secondary — later)
   Dropbox webhook (folder changed) ──► incoming-webhook intake ──► SQS ──► connector
        • list folder (cursor) · dedupe seen file ids · DOWNLOAD selected CSV
        └─► emit `dropbox.file.created` → workflow → hand file to CONTACT IMPORT (validate · dedupe · consent)

 AUTH:  per-account Dropbox OAuth2 → tokens minted + vaulted via the marketplace broker (reference-only)
 GOVERNANCE: accept-to-enable · dataJurisdiction cross-border gate · metering · egress flag × user-permission
```

* **Outbound-first, idempotent.** Delivery is keyed by `(accountId, outputKey, path)`; a redelivered
  `report.completed` (or a retried action) re-targets the same path with overwrite-by-rev or autorename — no
  duplicate, no double-count of the metered upload.
* **No new engine.** Token + vault = marketplace; trigger/route = workflow; artifact = report (S3); throttle =
  the shared framework; intake (inbound) = the shared webhook intake. Dropbox adds a **connector adapter +
  upload mechanics**, not infrastructure.

# Capabilities — what the connector does

The connector contributes a small typed surface to [workflow](../../core/workflow/SPECS.md) (an action node +,
later, a trigger node) and serves the report-delivery path. Least-privilege scopes follow the enabled set.

| Capability | Direction | Dropbox API | Notes |
|---|---|---|---|
| **Deliver file to folder** (the headline) | outbound | `/files/upload` · `upload_session/{start,append_v2,finish}` | small → single upload; large → **resumable session**; overwrite-by-rev or autorename; returns `{ fileId, path, rev }` |
| **Create shared link** *(optional, per delivery)* | outbound | `/sharing/create_shared_link_with_settings` | account-chosen visibility / expiry; returned with the file id |
| **List / create folder** | outbound | `/files/list_folder` · `/files/create_folder_v2` | ensure the target path exists (idempotent); pick a destination in the connect UI |
| **Fetch / download a file** *(secondary)* | inbound | `/files/download` | pull a selected CSV for the contact import |
| **New-file-in-folder trigger** *(secondary, later)* | inbound | webhook + `/files/list_folder/continue` (cursor) **or** poll + dedupe | normalize → `dropbox.file.created`; feeds a contact-import workflow |

> **Scopes follow capability** (least-privilege): `files.content.write` (+ `sharing.write` only if shared-link
> delivery is enabled) for outbound; `files.content.read` + `files.metadata.read` for the secondary inbound pull.
> Request only what the enabled capabilities need (`marketplace-3.4`).

# Files & PII

* **Egress to account-controlled storage.** A delivered report can contain **contact PII** (names, phones,
  emails, message history). Writing it to the **account's own Dropbox** is **egress to storage the account
  controls** — the **account is the controller** of that copy, exactly as in the
  [marketplace](../../core/marketplace/SPECS.md) sub-processor model. Dropbox is a **sub-processor** of the
  account's data; enabling the connector takes the **accept-to-enable** path (terms / privacy / data-sharing ack),
  and an **EU account** delivering to a **US**-jurisdiction Dropbox hits the **cross-border gate** (`marketplace-2.7`).
* **Egress erasure boundary.** Once a file lands in the account's Dropbox, it is **downstream**: on a contact
  forget, erasure = **stop-delivering** future artifacts containing that subject **+ disclose** where prior copies
  went — **not** reach-in-and-delete the account's Dropbox files (we don't own that store) — the root
  [egress erasure boundary](../../../docs/SPECS.md). The platform-side artifact is purged on the
  [report](../../core/report/SPECS.md) retention TTL / forget fan-out (`report-11.1`).
* **Inbound files carry PII too.** A pulled contact CSV is **PII-bearing**; it flows straight into the
  [contact](../../core/contact/SPECS.md) import (validate · dedupe · consent) and is **not** persisted by this
  connector beyond the in-flight handoff.
* **No PII in logs.** Log **opaque ids** (connection id, file id, transaction id) only — **never** file contents,
  folder contents, names, or the shared-link URL body. Dry-run logs **intent** (target path, byte count), not
  content.

# Auth & governance

* **Per-account OAuth2.** The account authorizes via **Dropbox OAuth2**; tokens are **minted + vaulted via the
  [marketplace](../../core/marketplace/SPECS.md) OAuth broker**, **auto-refreshed** (Dropbox short-lived access
  token + refresh token), revocable — the [zapier](../zapier/SPECS.md) auth model. The connector holds a vault
  **reference**, never the token (`marketplace-3.1/3.3`).
* **Least-privilege scopes.** Request only the scopes the enabled capabilities need (above) — write for delivery,
  read/metadata for the optional inbound pull, `sharing.write` only when shared links are enabled.
* **Marketplace / Zapier governance.** A [marketplace](../../core/marketplace/SPECS.md) `IntegrationDefinition`
  (category **`STORAGE`**) under the Zapier pattern: **accept-to-enable**, the **`dataJurisdiction` cross-border
  gate**, **metering** (files delivered / bytes / shared links), and **egress = feature-flag × the connecting
  user's permission**. The **account is the controller**. `multiInstance` (several Dropbox destinations per
  account — agency / multi-brand) follows the marketplace default-off opt-in.
* **Egress gate.** Every outbound upload runs the marketplace **egress gate** (feature-flag × the connecting
  user's permission) before the connector executes — the `MarketplaceActionJob` discipline (`marketplace-14.4`).
* **Kill switches** — disable / **dry-run** (log the intended upload, write nothing) / pause the connection
  (AppConfig + the marketplace lifecycle).

# Reliability

* **Throttle like an SMS provider.** Dropbox enforces **per-app / per-user rate limits**; outbound uploads ride
  the shared framework's **token-bucket throttle × per-account fair-share** (no one account's report fan-out
  starves the queue) — the **same pattern** as [zapier](../zapier/SPECS.md) and the
  [texting](../../core/texting/SPECS.md) SMS-provider throttle. **Reused, not reinvented.**
* **Backpressure + retry.** **429** (`Retry-After`) / **5xx** ⇒ **computed-delay requeue** (backpressure, not
  hammer) → **retry** → **DLQ** after threshold; a sustained-failure connection **auto-pauses** + **alerts**
  ([monitor](../../core/monitor/SPECS.md)).
* **Resumable large uploads.** Files above the single-shot limit use a **chunked upload session** that resumes
  from the **last committed offset** on interruption — a partial upload doesn't restart from zero or leave a
  half-written file (the session is committed atomically at `finish`).
* **Idempotent.** Delivery keyed by `(accountId, outputKey, path)`; a redelivery overwrites-by-rev or autorenames
  per config — no duplicate file, no double-metered upload. The inbound pull dedupes on the Dropbox **file id**.

# Out of scope

* **A general Dropbox file manager / sync client** — we **deliver** (and optionally **pull**) specific artifacts;
  we don't mirror, browse, or two-way-sync the account's Dropbox.
* **Dropbox Paper / team-admin / file-request APIs** — not a delivery surface; deferred.
* **Editing or transforming the artifact** — the file is produced by [report](../../core/report/SPECS.md) /
  the export; this connector delivers it byte-for-byte.
* **Inbound at launch** — the new-file trigger + contact-import pull are **secondary / later** (gap #6); v1 is
  outbound delivery.

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — outbound delivery workers (`MarketplaceActionJob`) + retry; (inbound) webhook ingest buffering.
* **S3** — **read** the report artifact (`outputKey`) to upload; no separate Dropbox store.
* **Redis (ElastiCache)** — outbound **throttle** (token-bucket × per-account fair-share) + circuit-breaker state.
* **DynamoDB** — connection state · delivery idempotency keys · (inbound) seen-file-id dedupe.
* **Kafka (MSK)** — consume **`report.completed`** (the delivery trigger) + emit (inbound) `dropbox.file.created`.
* **API Gateway** — the small `/dropbox/*` OAuth callback / config / health surface (+ inbound webhook).
* **Secrets Manager** (+ **KMS**) — the per-account OAuth tokens (**via marketplace**, reference-only).

**Third-party**
* **Dropbox API v2** (`/files/*`, `/sharing/*`, upload sessions) + **OAuth2** — **Dropbox is a sub-processor** of
  the account's data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, S3, Cache, Dynamo, Kafka, SecretsManager, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **marketplace** (OAuth / vault / catalog / governance / connector runtime), **report** (the artifact +
  `report.completed`), **workflow** (action + trigger nodes), **contact** (inbound import), **monitor** (health /
  backpressure). Sibling: **[google-drive](../google-drive/SPECS.md)**.

# Compliance & standards mapping

How **this Dropbox connector's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, and **CCPA/CPRA**. Dropbox is an **account-controlled storage egress** — its dominant
controls are **OAuth secret custody**, **egress to account-controlled storage** (the account is controller), the
**egress erasure boundary**, **no-PII-in-logs**, and **resumable / idempotent** uploads. There is **no
conversion/consent surface** (this is a file sink, not a people-event integration). **No PCI / PHI** (➖).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Dropbox control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | |
|---|---|---|---|---|---|---|
| **OAuth secret custody** — per-account tokens in the **marketplace vault** (Secrets Manager + KMS); reference-only; auto-refresh / revoke | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ✅ |
| **Egress to account-controlled storage** — delivery to the account's **own** Dropbox; **account is controller**; sub-processor accept-to-enable | A08 | A.5.19–.23 | CC9.2 | Art 28 | §1798.140 | ✅ |
| **Egress erasure boundary** — delivered files are **downstream**; forget = **stop-delivering + disclose**, not reach-in-delete | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ✅ |
| **No PII in logs** — opaque ids; file contents / folder listings / shared-link bodies never logged; dry-run logs intent | A09 | A.5.34 / A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ✅ |
| **Encryption in transit** — TLS to the Dropbox API; artifact read from S3 (SSE-KMS) | A02 | A.8.24 | CC6.1 | Art 32 | ➖ | ✅ |
| **Idempotent delivery** — keyed by `(accountId, outputKey, path)`; redelivery overwrites-by-rev / autorenames; no duplicate / double-meter | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Resumable uploads** — chunked sessions resume from last committed offset; atomic `finish`; no half-written file | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Outbound throttle + backpressure** — token-bucket × fair-share (like SMS providers); 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Least-privilege scopes** — write for delivery; read/metadata only for the inbound pull; `sharing.write` only when links enabled | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ✅ |
| **Cross-border gate** — EU account → US Dropbox triggers the marketplace `dataJurisdiction` SCC acceptance | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ✅ |
| **Inbound file PII** — pulled CSV flows straight to contact import (validate · dedupe · consent); not persisted here | A04 | A.8.10 | (Privacy) | Art 6 | §1798.100 | ✅ |
| **Audit** — connect / disconnect / config change + each delivery (file id / path / no content) audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Archetype — DECIDED: storage, outbound-first.** Dropbox is a **delivery destination** for report/contact
   exports (`report-7.2`) + a workflow `integration-action` ("save file to folder"). Inbound (new-file trigger /
   contact-import pull) is **secondary / later**. **Not** a people-event integration — **no
   conversion/attribution, no consent-mapping** section.
2. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** A `STORAGE` `IntegrationDefinition` — per-account
   OAuth, accept-to-enable, `dataJurisdiction` cross-border gate, metering, egress flag × user-permission;
   **account = controller**. Sibling of [google-drive](../google-drive/SPECS.md).
3. ✅ **Erasure — DECIDED: egress boundary.** A delivered file is the account's; forget = **stop-delivering +
   disclose**, not reach-in-delete; the platform-side artifact purges on the report retention TTL / forget fan-out.
4. ✅ **Large files — DECIDED: resumable sessions.** Files above the single-shot limit use a **chunked upload
   session** (start → append → finish) that resumes from the last committed offset; atomic at `finish`.
5. ✅ **Throttle — DECIDED: like an SMS provider.** Dropbox rate limits → **token-bucket × fair-share** +
   **backpressure requeue** (honor `Retry-After`) + **DLQ** + **auto-pause + alert** — the shared framework, reused.
6. ⚠️ **Inbound new-file trigger + contact-import pull — OPEN (deferred).** The capability is sketched (webhook +
   cursor, or poll + dedupe → contact import), but the v1 ships **outbound delivery only**; the inbound surface
   (watch config, dedupe store, import handoff) is **not built** — gated on prioritization.
7. ⚠️ **Shared-link policy — OPEN.** Whether deliveries default to **no shared link** (file-id only) vs an
   account-configurable **expiring link** (and the visibility default) needs a product call — leaning **no link by
   default** (least exposure), opt-in per delivery.

# Requirements (traceable register)

The traceable register for the **Dropbox connector** (IDs **`dropbox-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** Dropbox owns the **delivery contract + upload mechanics +
folder/shared-link ops (+ optional inbound pull)**; OAuth/vault/governance = marketplace, the artifact +
`report.completed` = report, trigger/route = workflow, import = contact, throttle/DLQ = the shared framework.

## dropbox-1.0 Connection & auth — A
- **dropbox-1.1** **Per-account Dropbox OAuth2** — tokens minted + **vaulted via marketplace**, auto-refreshed; connector holds a **reference**, never the token *(gap #2)* — A
- **dropbox-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on account-inactive / revoked token; **least-privilege scopes** (`files.content.write` (+ `sharing.write` if links) for delivery; `files.content.read`/`files.metadata.read` for the inbound pull) — A
- **dropbox-1.3** **Connect config** — choose the default **folder path** + delivery options (overwrite / autorename, shared-link on/off); `multiInstance` for several destinations — B

## dropbox-2.0 Outbound delivery (the headline) — A
- **dropbox-2.1** **Deliver file to folder** — given an artifact ref (S3 `outputKey` + format) + target path + options, **ensure the folder path exists** then **upload**, returning `{ fileId, path, rev }` — A
- **dropbox-2.2** **Resumable large uploads** — files above the single-shot limit use a **chunked upload session** (start → append_v2 → finish), resuming from the last committed offset; atomic at finish *(gap #4)* — A
- **dropbox-2.3** **Idempotent delivery** — keyed by `(accountId, outputKey, path)`; overwrite-by-rev or autorename; no duplicate / double-meter — A
- **dropbox-2.4** **Optional shared link** — `create_shared_link_with_settings` per delivery (account-chosen visibility / expiry), returned with the file id *(gap #7)* — B
- **dropbox-2.5** **Report-delivery path** — consume **`report.completed`** via the account workflow + serve a workflow `integration-action` ("save file to folder") — A

## dropbox-3.0 Folder operations — B
- **dropbox-3.1** **List / create folder** (`list_folder` / `create_folder_v2`) — pick a destination in connect; ensure path exists (idempotent) — B

## dropbox-4.0 Inbound pull (secondary — later) — C
- **dropbox-4.1** **Fetch / download** a selected CSV (`/files/download`) and **hand to the contact import** (validate · dedupe · consent); not persisted here *(gap #6)* — C
- **dropbox-4.2** **New-file-in-folder trigger** — webhook + cursor (`list_folder/continue`) **or** poll + dedupe → normalize `dropbox.file.created` → contact-import workflow; dedupe on the Dropbox file id *(gap #6)* — C

## dropbox-5.0 Governance & PII — A
- **dropbox-5.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** · metering (files / bytes / links) · **egress = feature-flag × connecting-user permission**; **account = controller** *(gap #2)* — A
- **dropbox-5.2** **Egress erasure boundary** — delivered files are downstream; forget = **stop-delivering + disclose**, not reach-in-delete; platform artifact purges on the report TTL / forget fan-out *(gap #3)* — A
- **dropbox-5.3** **No PII in logs** — opaque ids; file/folder contents + shared-link bodies never logged; dry-run logs **intent** (path, byte count), not content — A
- **dropbox-5.4** **Kill switches** — disable / **dry-run** (log intent, write nothing) / pause (AppConfig + marketplace lifecycle) — A
- **dropbox-5.5** **Audit** — connect / disconnect / config change + each delivery (file id / path, no content) — B

## dropbox-6.0 Reliability — A
- **dropbox-6.1** **Throttle + backpressure + auto-pause** — uploads ride **token-bucket × fair-share** (like SMS providers); 429 (`Retry-After`) / 5xx → **computed-delay requeue** → DLQ → **auto-pause + alert** ([monitor](../../core/monitor/SPECS.md)) *(gap #5)* — A
- **dropbox-6.2** **Idempotent throughout** — delivery keyed; inbound dedupe on file id — A

## dropbox-7.0 Infra — A
- **dropbox-7.1** **SQS + DLQ** (delivery / inbound) · **S3** (read artifact) · **Redis** (throttle) · **DynamoDB** (connection / idempotency / dedupe) · **Kafka** (`report.completed` in; inbound event out) · **API Gateway** (`/dropbox/*` + webhook) · **Secrets Manager + KMS** (via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/dropbox/*`.
**Delivery is event/action-driven** (report.completed → workflow → connector, or a workflow `integration-action`)
— so the HTTP surface is **OAuth callback + config/health + an operator test-deliver** (+ an optional inbound
webhook), no per-file public API. **Access column:** **`-`** public/system · **`State`** = OAuth `state`-validated
callback · **`Provider-sig`** = signature-verified Dropbox webhook · account ladder **`USER`<`ACCOUNT`** ·
**`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/dropbox/oauth/install` | Begin OAuth (redirect to Dropbox authorize) | ACCOUNT | dropbox-1.1 |
| GET | `/dropbox/oauth/callback` | OAuth callback — exchange code, **vault** token (state-validated) | State | dropbox-1.1 |
| GET, PUT | `/dropbox/connections/{id}/config` | Connection config — default folder path · overwrite/autorename · shared-link on/off · dry-run | ACCOUNT | dropbox-1.3 / 5.4 |
| GET | `/dropbox/connections/{id}/folders` | List folders (pick a delivery destination) | USER | dropbox-3.1 |
| POST | `/dropbox/connections/{id}/test-deliver` | Operator test — deliver a sample artifact to the target path | ACCOUNT | dropbox-2.1 |
| POST | `/dropbox/webhook` | *(secondary)* Dropbox folder-changed webhook — verify → dedupe → SQS | Provider-sig | dropbox-4.2 |
| GET | `/dropbox/internal/deliver` | S2S: connector deliver entrypoint (report path / workflow action) — `{ outputKey, path, options }` | Internal | dropbox-2.1 |
| GET | `/dropbox/connections/{id}/status` | Connection health — token state · queue depth · backpressure · last delivery | USER | dropbox-6.1 |
| GET | `/dropbox/health` | Liveness / readiness (connector + delivery) | - | dropbox-7.1 |

# eof
