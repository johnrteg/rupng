#
# Contact Service
#

# Objective

A **light CRM**: the account's contact book — identity + PII, account-defined custom
fields, per-channel consent, and the platform's **primary segmentation tool**. It is
deliberately *not* a full CRM (no deals, pipelines, tasks, or opportunity tracking).

For most accounts the data arrives one of two ways:
1. **CSV/vCard upload** — lists the customer bought or exported elsewhere. We are the
   system of record.
2. **Bidirectional CRM sync** — a connector keeps us in step with the customer's own
   CRM (Salesforce, HubSpot, …), and **their CRM is the source of truth**.

Which one (and who wins on conflict) is per-account configuration.

# Role & boundaries

Contact **owns**:
* Contacts (identity, PII, custom-field values), per account.
* Custom-field **definitions** (typed, immutable type — see below).
* **Segments** (the query model) and their membership.
* **Consent / opt-in + opt-out / suppression** state per channel, per account.
* External-id mapping, sync metadata, import jobs, archival (never hard-delete) + GDPR forget.

Contact **delegates / does not own**:

| Concern | Owner |
|---|---|
| Indexed search & segment evaluation at scale | **search** (OpenSearch) — DDB is SoT but not indexable |
| Suppression *enforcement* at send time | **dispatch** (reads consent/suppression from here before sending) |
| Message/engagement **activity history** (sent, replies, opens, clicks) | **texting / email / analytics** — contact references it, doesn't store it |
| The CRM **connectors** themselves (Salesforce/HubSpot adapters, schedules) | **integrations / workflow** services — contact exposes a sync API + webhooks |
| Plan limits (max contacts, max custom fields) | **account** (`ResolvedEntitlements`) |

# Out of scope (light CRM)

* Deals / pipelines / opportunities / quotes.
* Tasks, calendars, activity *authoring*.
* Full interaction timeline storage (we link to it; messaging/analytics own it).

# Core concepts

* **Contact** — a person owned by an account: identity (`uuid`, name), multi-valued
  emails/phones (with context), address, `tz`, link, social, notes; custom-field values;
  tags (system/account/campaign); external refs; consent/suppression; segment membership;
  sync/audit metadata.
* **CustomFieldDefinition** — an account-defined, fixed-type field; mode `self` or `inherit`.
* **ExternalRef** — `(system → externalId)` mapping for sync + dedup.
* **Segment** — a named, saveable query over contacts with **static, snapshotted
  membership**; updated only by a **user-accepted refresh** (shown a count diff first).
* **ConsentRecord** — per-channel consent + suppression on the contact (state, source,
  reason, proof).
* **ImportJob** — an async CSV/vCard ingest with mapping, progress, and an error report.

# Data model & storage

* **DynamoDB is the source of truth** (per-account partitioned; `PK: accountId`,
  `SK: contactId`). It is **not** the query engine.
* **Search/segmentation runs against the search service** (OpenSearch), fed by
  `contact.*` change events. Reads there are eventually consistent — note the lag.
* Likely tables: `contacts`, `field_defs`, `segments`, `consent`, `import_jobs`.
  External-id lookups use a GSI (`system#externalId → contactId`) for sync upserts +
  dedup; richer lookups go through search.
* **Item-size caution:** free-text `notes` plus many custom fields meet DynamoDB's 400 KB
  item limit — large notes / wide contacts may need overflow handling. Flag, don't truncate.

# Requirements

## Contacts & PII
* Owned by an account; **a sub-account's contacts are not owned or visible to the parent.**
* **Identity:** a stable **`uuid`** (the contact id) + name.
* **Emails** — *multiple*, each with a **context** (`home` | `work` | `other`);
  **exactly one is marked the default**.
* **Phones** — *multiple*, each with a **type** (`cell` | `work` | `home` | `other`),
  stored E.164; **exactly one is marked the default**.
* **Address** (structured) and **`tz`** (timezone) — tz derived from address / area code,
  drives quiet-hours sending.
* **Link/URL** (profile or site), social handles, and **notes** (free-text, first-class —
  not a custom field).
* The customer's **own id** / list-company id are carried as **external refs** (sync/dedup);
  domain ids like **voter id** are **custom fields** (below).
* Phones/emails normalized on write (E.164, lowercased email). **Dedup + dispatch consider
  ALL of a contact's emails/phones, not just the default.**

## Custom fields (typed, immutable type, inheritable)
* A **reasonable, plan-gated** count per account — **not unlimited**. Suggested:
  **50 by default**, up to **~200** on higher plans, hard system cap **~250**. The ceiling
  is driven by search-index cost and item size, not a hard storage wall.
* Each field has a fixed **type**: `string`, `number`, `date`, `boolean`, `choice`
  (single), `multi_choice`, plus typed `email`/`phone`/`url`. Common uses: voter id,
  source list, tags, scores.
* **Type is immutable after definition** — to change a type you create a new field and
  migrate; the old one is retired, never re-typed. Values are validated on write.
* `choice`/`multi_choice` carry an option set; options may be **added** (never re-typed).
  Metadata: key, label, required?, default?, `indexed?` (surfaced to search).
* **Two definition modes** (multi-tenant):
  * **`self`** — defined and owned by the (sub-)account; it may edit or retire it.
  * **`inherit`** — defined by the **parent**, carried down to sub-accounts and
    **read-only there**: the sub-account populates values but cannot change or retire the
    definition (its type and options are locked from above).
  * Sub-accounts may always **add their own `self` fields** on top of inherited ones;
    inherited fields don't consume the sub-account's own field budget.
* Field **deletion is soft** (hidden/retired); existing values retained unless purged.

## Tags
Three independent tag namespaces on a contact, all queryable in segmentation:
* **System tags** — platform-applied, not user-editable (e.g. `bounced`, `engaged`, `imported`).
* **Account tags** — free-form labels the account defines and applies.
* **Campaign tags** — applied by campaigns (e.g. auto-tag on send/reply); carry the
  originating **campaign id** for provenance.

## External IDs & sync
* A contact stores **multiple external refs** — `{ salesforce: "003...", hubspot: "12", listco: "abc" }` — used for **dedup** and for **upsert-by-external-id** on sync.
* **Source-of-truth config** per account (and optionally per field): ours vs the external
  CRM. Conflict resolution = last-write-wins by `lastModifiedAt`, or external-always-wins,
  per config.
* **Sync metadata** on every contact: `createdAt/By`, `lastModifiedAt/By`,
  `lastSyncAt` (per system), `sourceSystem`, and a `version`/etag for optimistic concurrency.
* **Webhooks** in (ingest CRM changes) and out (push ours). Outbound is **HMAC-signed**
  (per the auth spec); inbound is idempotent (dedupe by external event id).
* **Loop prevention:** stamp each change with its origin; a change that arrived *from* a
  system is **not** echoed back to that system. Watch for sync storms.

## Import (CSV / vCard)
* Large async ingest with **column→field mapping**, **normalization**, **dedup mode**
  (skip / update / create), and a **dry-run preview** (counts, sample, conflicts).
* **Progress + completion notification**; **partial-failure** tolerated with a
  downloadable per-row error report.
* Tag imported contacts with the **import batch id / list source** (provenance).
* Idempotent re-runs (same batch doesn't double-create).

## Dedup & merge
* Match keys: email, normalized phone, and any external id; match rules configurable.
* On collision: skip / update / **merge** with field-level survivorship; manual merge for
  ambiguous cases. Runs on both import and sync.

## Segmentation  *(the primary tool)*
* A **Segment** is a saved query over system + custom fields with comparisons (`eq`,
  `neq`, `contains`, `gt/lt`, `in`, `exists`, date ranges) and boolean groups (AND/OR/NOT).
* **Static membership** — the query is evaluated and the result set is **snapshotted**.
  Live / auto-updating segments are intentionally **deferred for now**: continuous
  re-evaluation makes capping send costs hard to reason about (a segment could grow between
  approval and send). Revisit later behind that cost-control story.
* **Refresh is user-initiated, never silent.** A user requests a refresh; the service first
  shows a **count diff** (would-add / would-remove vs current membership), and the new
  membership is applied **only on explicit accept** — no membership drift behind the user's back.
* **Sub-segments** (filter within a segment) — consumed by the campaign service.
* **Membership is queryable from the contact**: a contact ↔ segment **join** records which
  segments a contact belongs to (explicit snapshotted rows), so "what segments is this
  contact in?" is a direct lookup, not a full re-scan.
* Size/count + preview; **exclusion segments**. Segments power campaign audience selection;
  campaign owns the send-time freeze, contact provides the query + consent overlay.
* **Segments are archivable, never deletable.** Archiving hides a segment from active use
  but preserves it (and its membership snapshot) for audit/history — a past campaign must
  always be able to point at the exact segment it sent to.

## Consent & suppression
* **Suppression lives on the contact**, per channel (`sms`, `email`, `voice`, …):
  whether suppressed, **from where** (origin: STOP reply, manual, import, CRM sync,
  complaint, hard bounce) and **why** (reason), plus a timestamp — the record of *how* a
  contact came to be suppressed.
* **Per-channel consent / opt-in**: state (`opted_in` / `opted_out` / `unknown` /
  `pending`), timestamp, source, and **proof** (for TCPA).
* **Dispatch must verify suppression + consent before sending** (it reads from here).
* **Non-contacts** (e.g. a STOP from an unknown number) are covered by the **account-level
  block list** owned by the **account** service — a global, by-value do-not-contact list.
  Dispatch checks both that block list and this per-contact suppression. An account
  preference can **auto-promote a contact's opt-out into that block list** for durable
  suppression (survives contact archival / re-import).
* Store/derive **timezone** (from address / area code) to support quiet-hours sending.

## Search
* **Not served from DynamoDB** (SoT, not indexable) — the search service indexes
  contacts, including `indexed` custom fields, with faceting + comparisons. Eventually
  consistent with the SoT.

## Archive & GDPR
* **Contacts are archived, never deleted** (for audit). "Delete" is a soft archive:
  `isDeleted` + `deletedAt` + `deletedBy`; excluded from segments/search by default,
  **restorable**, and **retained indefinitely** — no automatic purge (same
  archive-not-delete rule as segments and campaigns).
* **GDPR forget produces a redacted tombstone, not a row deletion.** The contact's
  **`uuid` shell is retained** — so audit trails, campaign run history, segment membership,
  and invoices that reference it stay referentially intact — while **all PII is irreversibly
  purged**: name, every email/phone, address, social, notes, custom-field values, and
  external refs. The shell is marked **`gdprForgotten` + `forgottenAt` + `forgottenBy`**
  (+ reason). Propagated to search (drop indexed PII) and, per config, to synced external
  systems. A forgotten shell is inert: never re-identifiable, never sendable, never in a segment.
* The retained `uuid` carries no personal data; external refs are purged precisely so the
  shell can't be re-linked to the person. (A full row deletion remains available only if
  policy forbids even the tombstone.)

## Export
* Export contacts and segments to CSV (and other formats); **audit who/what/when**.
* Export a **single contact + its interactions** (joining referenced activity from
  messaging/analytics).

## Audit & change tracking
* Track `createdAt/By`, `lastModifiedAt/By` on every contact (who + when).
* Audit export and bulk operations. (Full field-level change history optional/configurable.)

## Multi-tenancy & limits
* Strict account ownership + sub-account isolation (no parent visibility into contacts).
* Custom-field definitions support `self` and `inherit` modes (above): a parent pushes
  locked-down inherited fields; sub-accounts add their own.
* Plan-gated limits (max contacts, max custom fields) via `ResolvedEntitlements`.

# Open decisions

1. **Conflict resolution default:** last-write-wins (by `lastModifiedAt`) vs
   external-always-wins when the CRM is the configured source of truth.
2. **Field-level change history:** full per-field audit trail, or just last-modified?
