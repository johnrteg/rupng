#
# Google Drive integration
#

# Objective

Connect an **account's Google Drive** as a **storage destination** — the place the platform **delivers a
generated artifact**: a [report](../../core/report/SPECS.md) export (CSV / PDF / Excel / JSON) or a contact
export, dropped into a designated folder, with the **file id** (and an optional **shared link**) returned.
*"My month-end delivery-summary CSV lands in our `RumbleUp/Reports` Drive folder every Monday."* This is **mainly
outbound file delivery** — Drive is the **sink**, the platform's report/export factory is the **source**.

This is the **storage end of the report delivery path**: [report](../../core/report/SPECS.md) generates an
artifact to S3 and publishes **`report.completed`**; the **account's [workflow](../../core/workflow/SPECS.md)**
consumes it and routes the deliverable to a destination — and *this connector is one of those destinations*
(`report-7.2`). It is also a plain workflow **`integration-action`** node — **"save file to folder"** — any flow
can call (`workflow-6.2`).

A **secondary, later** direction is **inbound**: import a **CSV of contacts** from a watched / selected folder
(a **"new file in folder" trigger** or an on-demand pull) → hand to the [contact](../../core/contact/SPECS.md)
import. Imported files may carry **PII**; handled under *Files & PII* below.

This is **not a new data plane.** Drive is **account-connected**, so it lives under
**[marketplace](../../core/marketplace/SPECS.md)** governance — **per-account OAuth**, the **Zapier governance
pattern** ([zapier](../zapier/SPECS.md): accept-to-enable · `dataJurisdiction` cross-border gate · metering ·
egress feature-flag × permission). **The account is the controller.** Outbound delivery rides the shared
connector/dispatch framework (throttle · retry · DLQ); secrets ride the **marketplace vault**. Its sibling is
**[Dropbox](../dropbox/SPECS.md)** — same archetype, one adapter each behind the marketplace connector pattern.

# Role & boundaries

**Owns:**
* The **Drive delivery contract** — given an artifact reference (the report's S3 `outputKey`) + a target
  **folder id** + options (overwrite-existing / new-version vs. create, make-shared-link), **upload** the file
  and return `{ fileId, parents, sharedLink? }`.
* **Upload mechanics** — small files via a **simple / multipart upload**; large files via Drive's **resumable
  upload** protocol (init session → `PUT` chunks at byte offsets → finalize), with **resume** on interruption.
* **Folder + shared-link operations** — list / create a folder (a `files.create` with the folder MIME type
  under a parent **id**), set sharing via **`permissions.create`** for a shareable link with the account's chosen
  role / visibility.
* **Inbound pull** *(secondary)* — list a watched folder, **download / export** a selected CSV, and hand it to
  the contact import; derive the **"new file in folder"** trigger.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **The artifact itself** (generation, S3 storage, `report.completed`) | **[report](../../core/report/SPECS.md)** |
| **What to deliver where / when** (the trigger graph) | **[workflow](../../core/workflow/SPECS.md)** (this connector is an `integration-action`; the new-file trigger is a trigger node) |
| **Contact identity + the import pipeline** (validate · dedupe · consent) | **[contact](../../core/contact/SPECS.md)** |
| **Pacing / retry / DLQ / fair-share** of outbound uploads | the shared **connector / dispatch framework** |
| **Secrets** (per-account Google OAuth tokens) | **marketplace vault** (Secrets Manager + KMS, reference-only) |
| **Failure / backpressure alerting** | **[monitor](../../core/monitor/SPECS.md)** |

> **No PII reach-down; the account is controller.** Drive is the **account's own** storage. Delivering a report
> there is **egress to account-controlled storage**. When a contact is forgotten, erasure here = **stop-delivering
> + disclose**, not reach-in-delete (the [egress erasure boundary](../../../docs/SPECS.md)) — see *Files & PII*.

# Core concepts

* **Connection (installation)** — an account's connected Google Drive: the OAuth grant (vaulted in marketplace),
  the account's chosen **destination folder id** (and, for Workspace, the shared-drive id), and connection
  health. Lifecycle is the marketplace `enable → connect → active → pause → remove` (+ **auto-pause** on
  account-inactive / revoked token).
* **Delivery** — one outbound **save-file-to-folder**: an artifact reference (S3 `outputKey` + format) + a target
  **folder id** + options → an upload → `{ fileId, parents, sharedLink? }` returned to the caller (the workflow
  instance / the report-delivery path). **Idempotent** — keyed by `(accountId, outputKey, folderId)` so a
  redelivery doesn't double-write (new-version on the existing fileId, or create-fresh per config).
* **Resumable upload** — Drive's **resumable upload session** (init → chunked `PUT` at byte offsets → finalize)
  that **survives interruption** and resumes from the last acknowledged offset — used for any non-trivial
  artifact; the storage analogue of the throttle/requeue pattern.
* **Folder id** — Drive addresses files + folders by **opaque id** (not a path — contrast
  [Dropbox](../dropbox/SPECS.md), which uses **paths**). A file's location is its **`parents`**; the connector
  resolves / creates the destination folder id before upload.
* **`drive.file` scope (least-privilege)** — Drive's **`drive.file`** scope grants access **only to files the app
  created** (and ones the user explicitly opens with it) — *not* the user's whole Drive. This is the
  **least-privilege** choice for a delivery connector and avoids Google's **restricted-scope** verification +
  CASA security assessment that the broad `drive` scope triggers.
* **Shared link** — an optional **`permissions.create`** call grants a link role (e.g. `reader`) with the
  account's chosen visibility, and the file's `webViewLink` is returned alongside the file id.
* **New-file trigger** *(secondary)* — a Drive folder gains a file → a normalized **`googledrive.file.created`**
  event (via Drive's **push notifications / `changes.watch`** channel + a page token, or a poll-and-dedupe),
  feeding a contact-import workflow.

# Architecture & flow

```
 OUTBOUND DELIVERY  (the headline)
   report.completed (Kafka)  ──► ACCOUNT WORKFLOW ── routes delivery
        │  OR a workflow integration-action ("save file to folder")
        └─► google-drive CONNECTOR  (MarketplaceActionJob)
                 • resolve fresh token (marketplace vault reference)  • resolve/create destination folder id
                 • read artifact from S3 (the report outputKey)
                 └─► UPLOAD to Google Drive API v3
                          small  → multipart upload (files.create)
                          large  → RESUMABLE session: init → PUT chunks @ offset → finalize
                          429/5xx → computed-delay requeue (NOT hammer) → retry → DLQ → auto-pause + alert
                     └─► optional permissions.create (shared link)  → webViewLink
                          └─► return { fileId, parents, sharedLink? } to the caller (workflow / report path)

 INBOUND PULL  (secondary — later)
   Drive push notification (changes.watch) ──► incoming-webhook intake ──► SQS ──► connector
        • changes.list (page token) · dedupe seen file ids · DOWNLOAD/export selected CSV
        └─► emit `googledrive.file.created` → workflow → hand file to CONTACT IMPORT (validate · dedupe · consent)

 AUTH:  per-account Google OAuth2 (drive.file least-privilege) → tokens minted + vaulted via marketplace broker
 GOVERNANCE: accept-to-enable · dataJurisdiction cross-border gate · metering · egress flag × user-permission
```

* **Outbound-first, idempotent.** Delivery is keyed by `(accountId, outputKey, folderId)`; a redelivered
  `report.completed` (or a retried action) re-targets the same folder with new-version-on-existing-id or
  create-fresh — no duplicate, no double-count of the metered upload.
* **No new engine.** Token + vault = marketplace; trigger/route = workflow; artifact = report (S3); throttle =
  the shared framework; intake (inbound) = the shared webhook intake. Drive adds a **connector adapter + upload
  mechanics**, not infrastructure.

# Capabilities — what the connector does

The connector contributes a small typed surface to [workflow](../../core/workflow/SPECS.md) (an action node +,
later, a trigger node) and serves the report-delivery path. Least-privilege scopes follow the enabled set.

| Capability | Direction | Google Drive API | Notes |
|---|---|---|---|
| **Deliver file to folder** (the headline) | outbound | `files.create` (multipart) · **resumable upload** | small → multipart; large → **resumable session**; new-version on existing id or create-fresh; returns `{ fileId, parents }` |
| **Create shared link** *(optional, per delivery)* | outbound | `permissions.create` | account-chosen role / visibility; `webViewLink` returned with the file id |
| **List / create folder** | outbound | `files.list` · `files.create` (folder MIME) | resolve / create the destination folder **id** under a parent; pick a destination in the connect UI |
| **Fetch / download a file** *(secondary)* | inbound | `files.get?alt=media` · `files.export` | pull a selected CSV for the contact import |
| **New-file-in-folder trigger** *(secondary, later)* | inbound | `changes.watch` (push) + `changes.list` (page token) **or** poll + dedupe | normalize → `googledrive.file.created`; feeds a contact-import workflow |

> **Scope follows capability** (least-privilege): **`drive.file`** (only files the app created) for delivery —
> avoiding the broad `drive` scope's restricted-scope verification; `drive.readonly` / `drive.metadata.readonly`
> only for the secondary inbound pull. Request only what the enabled capabilities need (`marketplace-3.4`).

# Files & PII

* **Egress to account-controlled storage.** A delivered report can contain **contact PII** (names, phones,
  emails, message history). Writing it to the **account's own Google Drive** is **egress to storage the account
  controls** — the **account is the controller** of that copy, exactly as in the
  [marketplace](../../core/marketplace/SPECS.md) sub-processor model. Google is a **sub-processor** of the
  account's data; enabling the connector takes the **accept-to-enable** path (terms / privacy / data-sharing ack),
  and an **EU account** delivering to a **US**-jurisdiction Drive hits the **cross-border gate** (`marketplace-2.7`).
* **Egress erasure boundary.** Once a file lands in the account's Drive, it is **downstream**: on a contact
  forget, erasure = **stop-delivering** future artifacts containing that subject **+ disclose** where prior copies
  went — **not** reach-in-and-delete the account's Drive files (we don't own that store) — the root
  [egress erasure boundary](../../../docs/SPECS.md). The platform-side artifact is purged on the
  [report](../../core/report/SPECS.md) retention TTL / forget fan-out (`report-11.1`).
* **Inbound files carry PII too.** A pulled contact CSV is **PII-bearing**; it flows straight into the
  [contact](../../core/contact/SPECS.md) import (validate · dedupe · consent) and is **not** persisted by this
  connector beyond the in-flight handoff.
* **No PII in logs.** Log **opaque ids** (connection id, file id, transaction id) only — **never** file contents,
  folder listings, names, or the shared-link URL body. Dry-run logs **intent** (target folder id, byte count),
  not content.

# Auth & governance

* **Per-account Google OAuth2.** The account authorizes via **Google OAuth2** (Workspace or consumer); tokens are
  **minted + vaulted via the [marketplace](../../core/marketplace/SPECS.md) OAuth broker**, **auto-refreshed**
  (Google access + refresh token), revocable — the [zapier](../zapier/SPECS.md) auth model. The connector holds a
  vault **reference**, never the token (`marketplace-3.1/3.3`).
* **Least-privilege scope = `drive.file`.** Request **`drive.file`** (access only to files the app created) for
  delivery — *not* the broad `drive` scope, which is a **restricted scope** triggering Google's app verification +
  **CASA** security assessment. `drive.readonly` / `drive.metadata.readonly` only when the secondary inbound pull
  is enabled; `permissions` is covered by `drive.file` for links on app-created files.
* **Marketplace / Zapier governance.** A [marketplace](../../core/marketplace/SPECS.md) `IntegrationDefinition`
  (category **`STORAGE`**) under the Zapier pattern: **accept-to-enable**, the **`dataJurisdiction` cross-border
  gate**, **metering** (files delivered / bytes / shared links), and **egress = feature-flag × the connecting
  user's permission**. The **account is the controller**. `multiInstance` (several Drive destinations / shared
  drives per account — agency / multi-brand) follows the marketplace default-off opt-in.
* **Egress gate.** Every outbound upload runs the marketplace **egress gate** (feature-flag × the connecting
  user's permission) before the connector executes — the `MarketplaceActionJob` discipline (`marketplace-14.4`).
* **Kill switches** — disable / **dry-run** (log the intended upload, write nothing) / pause the connection
  (AppConfig + the marketplace lifecycle).

# Reliability

* **Throttle like an SMS provider.** Drive enforces **per-user / per-project quotas** (requests + upload
  bandwidth); outbound uploads ride the shared framework's **token-bucket throttle × per-account fair-share** (no
  one account's report fan-out starves the queue) — the **same pattern** as [zapier](../zapier/SPECS.md) and the
  [texting](../../core/texting/SPECS.md) SMS-provider throttle. **Reused, not reinvented.**
* **Backpressure + retry.** **429** / **403 `userRateLimitExceeded`** / **5xx** ⇒ **computed-delay requeue**
  (exponential backoff + jitter, backpressure not hammer) → **retry** → **DLQ** after threshold; a
  sustained-failure connection **auto-pauses** + **alerts** ([monitor](../../core/monitor/SPECS.md)).
* **Resumable large uploads.** Non-trivial artifacts use Drive's **resumable upload session**, resuming from the
  **last acknowledged byte offset** on interruption (query the session for the offset, continue) — a partial
  upload doesn't restart from zero or leave a half-written file (the session finalizes atomically).
* **Idempotent.** Delivery keyed by `(accountId, outputKey, folderId)`; a redelivery writes a new version on the
  existing file id or creates fresh per config — no duplicate file, no double-metered upload. The inbound pull
  dedupes on the Drive **file id**.

# Out of scope

* **A general Drive file manager / Google Docs editing** — we **deliver** (and optionally **pull**) specific
  artifacts; we don't mirror, browse, or two-way-sync the account's Drive, nor edit Docs/Sheets.
* **Broad-Drive access (`drive` scope) / Workspace admin APIs** — we stay on **`drive.file`** least-privilege;
  full-Drive read is out of scope (and would trigger restricted-scope verification).
* **Editing or transforming the artifact** — the file is produced by [report](../../core/report/SPECS.md) /
  the export; this connector delivers it byte-for-byte (CSV stays a CSV — no auto-convert to Google Sheets unless
  later requested).
* **Inbound at launch** — the new-file trigger + contact-import pull are **secondary / later** (gap #6); v1 is
  outbound delivery.

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — outbound delivery workers (`MarketplaceActionJob`) + retry; (inbound) push-notification ingest buffering.
* **S3** — **read** the report artifact (`outputKey`) to upload; no separate Drive store.
* **Redis (ElastiCache)** — outbound **throttle** (token-bucket × per-account fair-share) + circuit-breaker state.
* **DynamoDB** — connection state · delivery idempotency keys · (inbound) page token + seen-file-id dedupe.
* **Kafka (MSK)** — consume **`report.completed`** (the delivery trigger) + emit (inbound) `googledrive.file.created`.
* **API Gateway** — the small `/google-drive/*` OAuth callback / config / health surface (+ inbound push channel).
* **Secrets Manager** (+ **KMS**) — the per-account OAuth tokens (**via marketplace**, reference-only).

**Third-party**
* **Google Drive API v3** (`files.*`, `permissions.*`, resumable upload, `changes.*`) + **Google OAuth2** —
  **Google is a sub-processor** of the account's data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, S3, Cache, Dynamo, Kafka, SecretsManager, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **marketplace** (OAuth / vault / catalog / governance / connector runtime), **report** (the artifact +
  `report.completed`), **workflow** (action + trigger nodes), **contact** (inbound import), **monitor** (health /
  backpressure). Sibling: **[dropbox](../dropbox/SPECS.md)**.

# Compliance & standards mapping

How **this Google Drive connector's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, and **CCPA/CPRA**. Drive is an **account-controlled storage egress** — its dominant
controls are **OAuth secret custody + `drive.file` least-privilege**, **egress to account-controlled storage**
(the account is controller), the **egress erasure boundary**, **no-PII-in-logs**, and **resumable / idempotent**
uploads. There is **no conversion/consent surface** (this is a file sink, not a people-event integration). **No
PCI / PHI** (➖).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Google Drive control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | |
|---|---|---|---|---|---|---|
| **OAuth secret custody** — per-account tokens in the **marketplace vault** (Secrets Manager + KMS); reference-only; auto-refresh / revoke | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ✅ |
| **`drive.file` least-privilege** — access only to files the app created; avoids the broad `drive` restricted scope + CASA assessment | A01 / A05 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ✅ |
| **Egress to account-controlled storage** — delivery to the account's **own** Drive; **account is controller**; sub-processor accept-to-enable | A08 | A.5.19–.23 | CC9.2 | Art 28 | §1798.140 | ✅ |
| **Egress erasure boundary** — delivered files are **downstream**; forget = **stop-delivering + disclose**, not reach-in-delete | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ✅ |
| **No PII in logs** — opaque ids; file contents / folder listings / shared-link bodies never logged; dry-run logs intent | A09 | A.5.34 / A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ✅ |
| **Encryption in transit** — TLS to the Drive API; artifact read from S3 (SSE-KMS) | A02 | A.8.24 | CC6.1 | Art 32 | ➖ | ✅ |
| **Idempotent delivery** — keyed by `(accountId, outputKey, folderId)`; redelivery new-versions / creates-fresh; no duplicate / double-meter | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Resumable uploads** — sessions resume from last acknowledged offset; atomic finalize; no half-written file | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Outbound throttle + backpressure** — token-bucket × fair-share (like SMS providers); 429/403 quota → backoff requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Cross-border gate** — EU account → US Drive triggers the marketplace `dataJurisdiction` SCC acceptance | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ✅ |
| **Inbound file PII** — pulled CSV flows straight to contact import (validate · dedupe · consent); not persisted here | A04 | A.8.10 | (Privacy) | Art 6 | §1798.100 | ✅ |
| **Audit** — connect / disconnect / config change + each delivery (file id / folder id / no content) audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Archetype — DECIDED: storage, outbound-first.** Drive is a **delivery destination** for report/contact
   exports (`report-7.2`) + a workflow `integration-action` ("save file to folder"). Inbound (new-file trigger /
   contact-import pull) is **secondary / later**. **Not** a people-event integration — **no
   conversion/attribution, no consent-mapping** section.
2. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** A `STORAGE` `IntegrationDefinition` — per-account
   OAuth, accept-to-enable, `dataJurisdiction` cross-border gate, metering, egress flag × user-permission;
   **account = controller**. Sibling of [dropbox](../dropbox/SPECS.md).
3. ✅ **Scope — DECIDED: `drive.file` least-privilege.** Access only to files the app created — avoids the broad
   `drive` restricted scope + Google's CASA security assessment; broad-Drive read is out of scope.
4. ✅ **Erasure — DECIDED: egress boundary.** A delivered file is the account's; forget = **stop-delivering +
   disclose**, not reach-in-delete; the platform-side artifact purges on the report retention TTL / forget fan-out.
5. ✅ **Large files — DECIDED: resumable upload.** Non-trivial artifacts use Drive's **resumable upload session**
   (init → chunked PUT @ offset → finalize) that resumes from the last acknowledged offset; atomic finalize.
6. ✅ **Throttle — DECIDED: like an SMS provider.** Drive quotas → **token-bucket × fair-share** + **backoff
   requeue** (429 / 403 `userRateLimitExceeded`) + **DLQ** + **auto-pause + alert** — the shared framework, reused.
7. ⚠️ **Inbound new-file trigger + contact-import pull — OPEN (deferred).** The capability is sketched
   (`changes.watch` + page token, or poll + dedupe → contact import), but v1 ships **outbound delivery only**; the
   inbound surface (watch channel renewal, page-token store, import handoff) is **not built** — gated on
   prioritization.
8. ⚠️ **CSV vs Google Sheets on delivery — OPEN.** Whether a delivered CSV stays a raw CSV (default — byte-for-byte)
   vs an account-opt-in **convert-to-Google-Sheets** needs a product call — leaning **raw CSV by default**.
9. ⚠️ **Shared-link policy — OPEN.** Whether deliveries default to **no shared link** (file-id only) vs an
   account-configurable link (and the role / visibility default) needs a product call — leaning **no link by
   default** (least exposure), opt-in per delivery.

# Requirements (traceable register)

The traceable register for the **Google Drive connector** (IDs **`googledrive-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** Drive owns the **delivery contract + upload mechanics +
folder/shared-link ops (+ optional inbound pull)**; OAuth/vault/governance = marketplace, the artifact +
`report.completed` = report, trigger/route = workflow, import = contact, throttle/DLQ = the shared framework.

## googledrive-1.0 Connection & auth — A
- **googledrive-1.1** **Per-account Google OAuth2** — tokens minted + **vaulted via marketplace**, auto-refreshed; connector holds a **reference**, never the token *(gap #2)* — A
- **googledrive-1.2** **`drive.file` least-privilege scope** — access only to files the app created (not broad `drive`); `drive.readonly`/`drive.metadata.readonly` only for the inbound pull *(gap #3)* — A
- **googledrive-1.3** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on account-inactive / revoked token — A
- **googledrive-1.4** **Connect config** — choose the destination **folder id** (+ shared-drive id for Workspace) + delivery options (new-version vs create, shared-link on/off, CSV-vs-Sheets); `multiInstance` for several destinations — B

## googledrive-2.0 Outbound delivery (the headline) — A
- **googledrive-2.1** **Deliver file to folder** — given an artifact ref (S3 `outputKey` + format) + target folder id + options, **resolve/create the folder id** then **upload**, returning `{ fileId, parents }` — A
- **googledrive-2.2** **Resumable large uploads** — non-trivial artifacts use Drive's **resumable upload session** (init → chunked PUT @ offset → finalize), resuming from the last acknowledged offset; atomic finalize *(gap #5)* — A
- **googledrive-2.3** **Idempotent delivery** — keyed by `(accountId, outputKey, folderId)`; new-version on existing id or create-fresh; no duplicate / double-meter — A
- **googledrive-2.4** **Optional shared link** — `permissions.create` per delivery (account-chosen role / visibility), `webViewLink` returned with the file id *(gap #9)* — B
- **googledrive-2.5** **Report-delivery path** — consume **`report.completed`** via the account workflow + serve a workflow `integration-action` ("save file to folder") — A

## googledrive-3.0 Folder operations — B
- **googledrive-3.1** **List / create folder** (`files.list` / `files.create` folder MIME) — pick a destination in connect; resolve/create the folder **id** under a parent (idempotent) — B

## googledrive-4.0 Inbound pull (secondary — later) — C
- **googledrive-4.1** **Fetch / download / export** a selected CSV (`files.get?alt=media` / `files.export`) and **hand to the contact import** (validate · dedupe · consent); not persisted here *(gap #7)* — C
- **googledrive-4.2** **New-file-in-folder trigger** — `changes.watch` (push) + `changes.list` (page token) **or** poll + dedupe → normalize `googledrive.file.created` → contact-import workflow; dedupe on the Drive file id *(gap #7)* — C

## googledrive-5.0 Governance & PII — A
- **googledrive-5.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** · metering (files / bytes / links) · **egress = feature-flag × connecting-user permission**; **account = controller** *(gap #2)* — A
- **googledrive-5.2** **Egress erasure boundary** — delivered files are downstream; forget = **stop-delivering + disclose**, not reach-in-delete; platform artifact purges on the report TTL / forget fan-out *(gap #4)* — A
- **googledrive-5.3** **No PII in logs** — opaque ids; file/folder contents + shared-link bodies never logged; dry-run logs **intent** (folder id, byte count), not content — A
- **googledrive-5.4** **Kill switches** — disable / **dry-run** (log intent, write nothing) / pause (AppConfig + marketplace lifecycle) — A
- **googledrive-5.5** **Audit** — connect / disconnect / config change + each delivery (file id / folder id, no content) — B

## googledrive-6.0 Reliability — A
- **googledrive-6.1** **Throttle + backpressure + auto-pause** — uploads ride **token-bucket × fair-share** (like SMS providers); 429 / 403 `userRateLimitExceeded` / 5xx → **backoff requeue** → DLQ → **auto-pause + alert** ([monitor](../../core/monitor/SPECS.md)) *(gap #6)* — A
- **googledrive-6.2** **Idempotent throughout** — delivery keyed; inbound dedupe on file id — A

## googledrive-7.0 Infra — A
- **googledrive-7.1** **SQS + DLQ** (delivery / inbound) · **S3** (read artifact) · **Redis** (throttle) · **DynamoDB** (connection / idempotency / page token / dedupe) · **Kafka** (`report.completed` in; inbound event out) · **API Gateway** (`/google-drive/*` + push channel) · **Secrets Manager + KMS** (via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/google-drive/*`.
**Delivery is event/action-driven** (report.completed → workflow → connector, or a workflow `integration-action`)
— so the HTTP surface is **OAuth callback + config/health + an operator test-deliver** (+ an optional inbound push
channel), no per-file public API. **Access column:** **`-`** public/system · **`State`** = OAuth `state`-validated
callback · **`Provider-sig`** = verified Drive push notification (channel token) · account ladder
**`USER`<`ACCOUNT`** · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/google-drive/oauth/install` | Begin OAuth (redirect to Google authorize — `drive.file`) | ACCOUNT | googledrive-1.1/1.2 |
| GET | `/google-drive/oauth/callback` | OAuth callback — exchange code, **vault** token (state-validated) | State | googledrive-1.1 |
| GET, PUT | `/google-drive/connections/{id}/config` | Connection config — destination folder id · new-version/create · CSV-vs-Sheets · shared-link on/off · dry-run | ACCOUNT | googledrive-1.4 / 5.4 |
| GET | `/google-drive/connections/{id}/folders` | List folders (pick a delivery destination) | USER | googledrive-3.1 |
| POST | `/google-drive/connections/{id}/test-deliver` | Operator test — deliver a sample artifact to the target folder | ACCOUNT | googledrive-2.1 |
| POST | `/google-drive/push` | *(secondary)* Drive push notification (`changes.watch`) — verify channel token → dedupe → SQS | Provider-sig | googledrive-4.2 |
| GET | `/google-drive/internal/deliver` | S2S: connector deliver entrypoint (report path / workflow action) — `{ outputKey, folderId, options }` | Internal | googledrive-2.1 |
| GET | `/google-drive/connections/{id}/status` | Connection health — token state · queue depth · backpressure · last delivery | USER | googledrive-6.1 |
| GET | `/google-drive/health` | Liveness / readiness (connector + delivery) | - | googledrive-7.1 |

# eof
