#
# Contact Service
#

# Objective

A **light CRM** — the account's **contact book**: identity + PII, account-defined custom fields, per-channel
consent, and the platform's **primary segmentation tool**. Deliberately **not** a full CRM (no deals, pipelines,
tasks, or opportunity tracking) — it is the **audience + consent layer the rest of the platform sends against**.

Three load-bearing roles make it central:

* **The segmentation / audience engine.** A **Segment** is a saved query over system + custom fields, and segments
  are what [campaign](../campaign/SPECS.md) selects an audience from. Membership is **snapshotted** (not live), so
  a campaign always knows exactly who it sent to. Get this right and every campaign targets cleanly; get it wrong
  and nothing downstream can.
* **The consent + suppression system of record.** Per-channel **opt-in / opt-out / suppression** lives here with
  **source + proof + timestamp** — the compliance backbone the channel's **`canSend()`** gate reads before *every*
  send (TCPA / CAN-SPAM / GDPR). Contact is the SoT for *"may we contact this person, on this channel."*
* **The platform's PII-densest service.** It holds names, emails, phones, addresses, and arbitrary custom-field
  values — so **GDPR / CCPA forget** (a **redacted tombstone**, not a row delete), the **data-classification**
  table, and **no-PII-in-logs/events** discipline dominate its design.

Data arrives one of two ways, **per-account configurable** (incl. who wins on conflict):
1. **CSV / vCard upload** — lists the customer bought or exported elsewhere. **We are the system of record.**
2. **Bidirectional CRM sync** — a connector keeps us in step with the customer's own CRM (Salesforce,
   HubSpot, …), and **their CRM is the source of truth**.

**The boundary in one line:** contact provides the **audience + consent overlay**; the **channels send**,
**[search](../search/SPECS.md)** indexes / evaluates at scale, and **[analytics](../analytics/SPECS.md)** holds the
engagement history — contact *references* it, never stores it.

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
| Suppression *enforcement* at send time | **channel** (the `canSend()` gate reads consent/suppression from here; **dispatch** governs only fairness/rate) |
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
* Likely tables: `contacts`, `field_defs`, `segments`, `consent`, `import_jobs`, `import_maps` (reusable
  column→field import maps — system catalog + per-account), `change_history`
  (**append-only version log** — `PK: accountId#contactId`, `SK: version`; holds the per-field
  `{ field, before, after }` diff + `{ who, when, source }` — see *Audit & change tracking*).
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
* **Language** — a **`primaryLanguage`** and optional **`secondaryLanguage`** (BCP-47 / locale tags, e.g.
  `en-US`, `es-ES`) — used by [campaign](../campaign/SPECS.md) to **select the localized message variant**
  (primary → secondary) and to **skip a contact whose languages a campaign doesn't support**, and available as
  a **segmentation/filter dimension**. Unset = treated as unmatched for language-gated sends.
* **Link/URL** (profile or site), social handles, and **notes** (free-text, first-class —
  not a custom field).
* The customer's **own id** / list-company id are carried as **external refs** (sync/dedup);
  domain ids like **voter id** are **custom fields** (below).
* Phones/emails normalized on write (E.164, lowercased email). **Dedup + the channel's send
  check consider ALL of a contact's emails/phones, not just the default.**

## Custom fields (typed, immutable type, inheritable)
* A **reasonable, plan-gated** count per account — **not unlimited**. Suggested:
  **50 by default**, up to **~200** on higher plans, hard system cap **~250**. The ceiling
  is driven by search-index cost and item size, not a hard storage wall.
* **Definition vs value.** The **definition** (uid · type · label · choices · group · order) is **account-level**
  — defined + managed under **Settings → Contacts**. Each contact stores only the **value**, keyed by field
  uid (`customFields: { [uid]: value }`) — the type/label/choices are never copied onto the contact.
* **Values are stored as strings.** The contact keeps `{ uid → string }` regardless of type; the **renderer
  converts to/from string** using the def's `type` (number/currency → numeric string, date/datetime → ISO,
  boolean → `"true"`/`"false"`, `choice` → the option key, `multi_choice` → keys joined by `,`). Keeps storage
  uniform; validation + (de)serialization live at the edges.
* Each field has a fixed **type**: `text`, `multiline` (multi-line text), `number`, `currency`, `date`,
  `datetime`, `choice` (dropdown single), `multi_choice` (dropdown multi / tag-like), `url`, `phone`, `email`,
  `boolean`. Common uses: voter id, source list, tiers, scores, budget.
* **Currency is per-field** — the field def fixes the ISO currency code (e.g. this "Budget" field is always
  `USD`); the value is stored in **minor units** (cents), formatted via the locale helper.
* **Type is immutable after definition** — to change a type you create a new field and
  migrate; the old one is archived, never re-typed. Values are validated on write.
* `choice`/`multi_choice` carry an option set of `{ key, label }`; options may be **added** (never re-keyed —
  a value stores the stable `key`, so relabeling never orphans data). Metadata: label, required?, default?,
  `indexed?` (surfaced to search → **usable as a segment filter condition**).
* **Order + grouping in the profile.** Each field carries a **`group`** (a label/context, e.g. "Work",
  "Preferences") and an **`order`** within that group, so the contact profile renders custom fields grouped +
  ordered rather than as a flat bag. Reorder/regroup is a def edit (no value migration).
* **Two definition modes** (multi-tenant):
  * **`self`** — defined and owned by the (sub-)account; it may edit or retire it.
  * **`inherit`** — defined by the **parent**, carried down to sub-accounts and
    **read-only there**: the sub-account populates values but cannot change or retire the
    definition (its type and options are locked from above).
  * Sub-accounts may always **add their own `self` fields** on top of inherited ones;
    inherited fields don't consume the sub-account's own field budget.
* **Fields are never removed — only archived.** There is no hard delete: a field's def flips to
  `archived` (hidden from the editor/profile) but is retained, and existing values are kept — because past
  segments, history, and imports may still reference it. Re-activate to bring it back.

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

### Target CRM integrations (connectors)
Each connector maps the external CRM's contact/constituent record ⇄ our Contact (external ref +
source-of-truth config + upsert-by-external-id), via the sync API + webhooks above. The connector adapters
themselves live in the integrations/workflow layer (a contact exposes the sync surface, not the vendor SDKs).
First wave:
* **HubSpot CRM** — free tier; OAuth app; Contacts API + webhooks. *(Priority — general CRM.)*
* **Zoho CRM** — free tier; OAuth; Contacts/Leads modules + notification webhooks. *(Priority — general CRM.)*

Nonprofit / donor CRMs (constituent = contact; carry donor fields as custom fields, keep giving history in the
external SoT):
* **Bloomerang** — REST API + API key; constituents.
* **DonorPerfect** — API (XML/REST); constituents/donors.
* **Little Green Light** — REST API + API key; constituents.
* **Neon CRM** — REST API (OAuth/API key); accounts (individuals).
* **Kindful** *(now Bloomerang-owned)* — REST API; contacts. Confirm API availability given the Bloomerang
  consolidation before building.

Notes: model each as an `ExternalRef` system key (`hubspot` / `zoho` / `bloomerang` / `donorperfect` / `lgl` /
`neon` / `kindful`); reuse the **import maps** catalog for the initial one-time import, and the sync
config/webhooks for the ongoing bidirectional flow. Rate limits + pagination are per-vendor (handle in the
connector).

## Import (CSV / vCard)
* Large async ingest with **column→field mapping**, **normalization**, **dedup mode**
  (skip / update / create), and a **dry-run preview** (counts, sample, conflicts).
* **Progress + completion notification**; **partial-failure** tolerated with a
  downloadable per-row error report.
* Tag imported contacts with the **import batch id / list source** (provenance).
* Idempotent re-runs (same batch doesn't double-create).

### Upload path — direct-to-bucket, scanned, then queued (large files bypass the API gateway)
CSV imports can be **very large**, so — exactly like media uploads — the file **never flows through the API
gateway**. The flow mirrors the media ingest pipeline (see [media SPECS](../media/SPECS.md) upload + scan):
1. **Presigned upload.** The client asks the contact service for a **presigned S3 PUT** (`POST /contact/imports/upload`
   → `{ url, importId, key }`) and uploads the raw file **directly to S3** (an `imports/` prefix in a private
   bucket). The gateway only ever sees the small JSON handshake, never the payload.
2. **Scan gate.** On upload-complete (S3 event or a `POST /contact/imports/{id}/complete`), the object is
   **malware/content-scanned** by the shared [`@repo/services` scanner](../../../packages/services/src/scan/)
   (the same platform scanner media uses). A file stays **QUARANTINED** until it passes; a failed scan is
   rejected (never parsed). This is why import is a first-class ingest, not an inline upload.
3. **Move + enqueue.** A clean file is moved to a **scanned/ready location** and a **`contact-import` SQS job**
   is enqueued; `ContactImportJob` streams the rows (map → normalize → dedup → write), emits progress, and
   writes the per-row error report. `execute()` on the endpoint stays fast (validate → presign / enqueue →
   `202`); the heavy parse/write is the Job (rows can number in the millions — never inline).

### Import maps (reusable column→field mapping configurations)
An **ImportMap** (`ImportMap` in `@repo/api`) is a saved, reusable mapping of a file's **column headings →
application fields** (including custom fields), plus per-column **ETL transforms** and file-level parse
options. It's what turns "an arbitrary CSV someone exported" into contacts without re-mapping every time.
The model lives in the **contact** domain (the most common import target) but is not contact-only — a `target`
field declares where the rows land, leaving room for other importers.
* **Target-aware.** Each map declares a `target` (`contact`, …) so the same catalog can serve more than one
  destination as future importers land — the editor renders the internal-field pickers for that target.
* **Source formats.** `sourceFormat` = `csv | tsv | xlsx | vcard | json` (CSV first). File-level `parse`
  options cover delimiter, quote char, header row, preamble `skipRows`, encoding, and (XLSX) sheet.
* **ETL adaptors (`transform` per column).** `none · trim · lowercase · uppercase · title_case · split_name`
  (one column → first/last) `· join` (many columns → one) `· split` (one → many) `· phone_e164 · email_normalize
  · date · datetime` (with a `format` + `timeZone`) `· boolean · number · country_code · constant · lookup`
  (value table) `· default_if_empty`. Adaptor config rides in `TransformOptions` (format, delimiter, sources,
  targetFields, constant, lookup, trueValues, defaultCountry, locale, timeZone, onError). A per-mapping/ map-level
  `onError` (`fail | skip_row | set_null | use_default`) governs bad values.
* **Dedup/upsert.** An optional `dedupe { mode: create | skip | update | merge, matchKeys: [email | phone |
  external_ref | custom] }` and per-mapping `isKey` flags drive how an incoming row reconciles with an existing
  contact — feeding the same dedup engine as sync (see **Dedup & merge**).
* **Provenance + authoring aids.** `defaultTags` are applied to every row imported with the map (batch/source
  provenance); `sampleHeaders` remembers a sample file's columns so the editor can offer real dropdowns; `notes`
  per mapping documents edge cases.
* **System maps (platform-defined).** A catalog of **standard** maps for common sources/CRMs (e.g. an **L2**
  voter-file layout, a generic vCard, a Mailchimp/HubSpot/Salesforce export). `scope = system`, stored under a
  reserved `system` partition, **versioned**, owned by the platform — every account **sees** them but **cannot
  edit** them; they can only **copy** one into their own space.
* **Account maps (custom).** An account defines its own maps (`scope = account`) for its recurring file shapes:
  **create / rename / edit / copy / archive / delete**. A **copy** (`ImportMap.Copy { sourceMapId, name? }`) is
  the primitive behind both "start from a system map" and "clone-and-tweak an account map"; `sourceMapId` records
  the origin and the system originals stay untouched.
* **Lifecycle / status.** `active | archived | deleted`. `archived` hides the map from pickers but keeps it
  (past import jobs / audit may reference it); `deleted` is a **soft-delete** — recoverable by an app admin and
  **purged by a cron after a TTL** (same pattern as custom fields + segments), never an immediate hard-delete.
* **Selection at import:** pick a map (system or account) for a file, preview the dry-run with that map, then
  run. The chosen `mapId` (+ its `version`) is **recorded on the ImportJob** for provenance/repeatability.
* **Model:** `ImportMap.Entity { id, accountId ("system" for platform maps), scope, name, description?, target,
  sourceFormat, parse?, mappings: Array<FieldMapping>, dedupe?, defaultTags?, sampleHeaders?, sourceMapId?,
  version?, status, audit }`, where `FieldMapping { externalField, internalField, transform?, options?, required?,
  isKey?, notes? }`. (New table `import_maps` PK `accountId` SK `mapId`, with the system catalog under a reserved
  `system` partition so an account reads system + its own maps in one Query.)
* **Management UI:** import maps are managed under **Settings → Contacts** (list system + account maps; copy a
  system map; create/rename/edit/archive/delete account maps) — separate from the per-import "pick a map" step.
  System maps render read-only with a **Copy** action; the import wizard just selects from the maps that exist.

## Dedup & merge
* Match keys: email, normalized phone, and any external id; match rules configurable.
* On collision: skip / update / **merge** with field-level survivorship; manual merge for
  ambiguous cases. Runs on both import and sync.

## Segmentation  *(the primary tool)*
* A **Segment** is a saved query over system + custom fields. The query language + the filterable-field
  catalog + the type→operator matrix live in `Segment` (`@repo/api`) and are documented (with the exception
  hook) in [Segment filters](../../../packages/api/src/contact/model/SEGMENT_FILTERS.md).
* **Boolean groups** are `all` (AND) / `any` (OR) / `none` (NOT) and **nest arbitrarily** (a rule may itself
  be a group). The web builder (`SegmentEditDialog` → `SegmentGroupEditor` → `SegmentConditionRow`) renders it
  with a type-aware operand editor per field. A **"belongs to segment / none of"** rule is how you say
  "these filters, **excluding** anyone in segment Y."
* **Optional sort + limit.** A segment may carry a `sort` (field + direction) and, only with a sort, a
  `limit` — cap membership to the **top-N by that sort** (e.g. return the 100 most-recent of 5,000 matches).
  Both optional; limit is meaningless without an order.
* **Preview** (`POST /contact/segments/preview`) evaluates an unsaved query against the account's contacts
  in-service (bounded per account) and returns the match count + a **small sample** (a dozen — the count is
  what matters), honoring sort + limit. A few derived fields (campaign audience, timezone-of-area-code) are
  non-constraining in preview until search-backed evaluation lands; the response flags them in `unsupportedFields`.
* **Materialization is a JOB, with a status lifecycle.** Saving a segment **retains its filter** (so it can be
  re-edited) and enqueues `contact-segment-materialize`; the job evaluates the filter, reconciles the
  **QUERY-sourced** join rows (leaving MANUAL/IMPORT members untouched), applies the sort + top-N limit, and
  recounts. Status flows `pending → processing → active` (active = materialized/complete), or `failed`
  (retryable). Other statuses: `inactive` (user-disabled), `archived`, `deleted`.
* **Filter is optional.** A segment sourced from an **import** has members without a filter (status `active`
  directly); adding a filter to it later further-refines that membership on the next materialize — same
  machinery, so imported lists can be filtered down after import.
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
* **Per-channel reachability counts on the segment.** A contact need not have every channel — depending on how
  the segment was built, some members have an email, some a phone, some neither. So a segment carries **counts
  per channel** (`channelCounts: { email, sms, voice, … }`) = how many members are actually **reachable +
  opted-in** on each channel (not just total `size`). This is what a campaign reads to show "12,000 members ·
  email 9,400 · SMS 6,100" and to estimate reach/cost per channel before a send. Counts are computed at
  membership refresh (alongside `size`); they exclude burned/opted-out channels so they reflect *sendable*
  reach, not raw presence.
* **Counts stay fresh on contact edits.** A contact's reachability can change *after* it joins a segment — add
  a cell number to a contact that had none and it's now SMS-reachable (and vice-versa: remove it / opt-out and
  it drops). So **saving a contact recomputes the per-channel counts of every segment that contact belongs
  to** (found via the `segment_members` `byContact` GSI). Because a contact can be in **many** segments, this
  runs as an **async job** (`contact-segment-refresh`, enqueued on contact create / update / archive /
  consent-change) rather than inline in the save — the save returns fast, counts converge shortly after.
  (Membership `size` itself only changes for *dynamic/query* segments on an explicit refresh; this job updates
  the **channel counts** of the segments the contact is already a member of.)
* **Segments are archivable, never deletable.** Archiving hides a segment from active use
  but preserves it (and its membership snapshot) for audit/history — a past campaign must
  always be able to point at the exact segment it sent to.

## Consent & suppression

> **TODO — refine consent/suppression grain to the channel-LINE INSTANCE (per email address / per phone
> number), not just the channel type.** A contact has *multiple* endpoints per channel (e.g. John Doe = 2 cell
> numbers + 3 emails = 5 line instances, each already carrying a context/type + a per-channel `default` flag,
> "Contacts & PII" above). Consent + suppression must be tracked **per instance**, because the signals that
> drive them are per-endpoint: a STOP/consent is for *that phone number* (TCPA proof is per number), an
> unsubscribe/complaint/hard-bounce is for *that email address*. Refinement:
> - **Grain:** the `ConsentRecord` + suppression key becomes `(contact, channel, endpoint)` where `endpoint`
>   is the normalized address (lowercased email / E.164 phone) — NOT just `(contact, channel)`. Each of John's
>   5 lines has its own opt-in/opt-out state + `source`/`at`/`proof` audit. **Compliance requires the ability
>   to set opt-in AND opt-out for each instance** (a preference center exposes this).
> - **Resolution = most-specific-wins:** evaluate the SPECIFIC endpoint a send will use (the channel `default`
>   when none is specified) against **instance → channel → contact/account** records; the finest record present
>   decides, and a block at any coarser level (a "stop all email" channel opt-out, or the account block list)
>   also blocks. `canSend()` / `reachable()` resolves the target endpoint first, then checks its consent.
> - **Preserved invariants:** still **account-wide, never per-campaign**; **burned-is-permanent** now applies at
>   the instance grain (a specific address/number that STOP'd / complained / hard-bounced is burned; the
>   contact's OTHER endpoints are unaffected) — a channel-wide opt-out burns every current + future endpoint on
>   that channel. Complaint / hard-bounce suppression stays inherently per-instance. The account block list
>   (account svc) is already **by-value**, so it's naturally per-endpoint.
> - **Rollups:** keep a channel-level view for segmentation (`channelCounts` — "reachable on email at all" =
>   any endpoint opted-in + not suppressed) and an optional explicit channel-wide / contact-wide (global
>   do-not-contact) opt-out as coarser overrides.
>
> *(Until refined, the per-channel model below is the effective behavior; the instance grain supersedes it.)*

* **Per-channel consent (opt-in / opt-out) lives on the contact** — a record per channel (`sms`, `email`,
  `voice`, …): `state` (`opted_in` / `opted_out` / `unknown` / `pending`), a **`source`** (where it happened —
  keyword, web form, import, API, agent), a **timestamp** (`at`), and **`proof`** (for TCPA). **Both opt-in and
  opt-out carry the `source`**, so we always know *where* each happened.
* **Time-based precedence — most recent wins.** The effective state per channel is the record with the
  **latest `at`**, so an **opt-in dated *after* an opt-out re-enables sending** (a re-subscribe) — and vice
  versa. *(Exception: complaint / hard-bounce suppression is a deliverability hard block, below — **not**
  cleared by a later opt-in timestamp.)*
* **Consent is per-channel AND account-wide — never per-campaign.** Opt-in / opt-out is recorded **per channel
  at the contact level for the whole account**, not per campaign: a person can be **opted-in for text but
  opted-out for email** for the same account. Every campaign the account runs reads this same per-channel state
  — there is **no per-campaign consent record** (a campaign targets contacts + inherits their channel consent;
  it doesn't hold its own consent copy). An *acquisition* list (an "Import opt-in" segment) is how consent is
  *captured*, but the resulting state still lives per-channel on the contact.
* **"Burned" is permanent + account-wide.** Once a contact has **opted out (or STOP'd / complained) on a
  channel for an account, they are suppressed on that channel for ALL future campaigns of that account** —
  permanently. This is the durable-suppression rule: a later per-campaign action can **never** re-enable a
  burned channel; only a genuine new **opt-in** (a fresh, dated, sourced consent record — the re-subscribe
  path above) can, and complaint/hard-bounce burns can't be cleared even by that. Enforced by auto-promoting
  the opt-out into the **account block list** (see account service) so it **survives contact archival and
  re-import** — a re-imported contact stays burned.
* **Suppression lives on the contact**, per channel: whether suppressed, **`origin`** (STOP reply, manual,
  import, CRM sync, complaint, hard bounce), a **`source`** (the specific provenance), a **reason**, and a
  **timestamp** — the record of *how* a contact came to be suppressed.
* **The channel verifies suppression + consent before sending** (the `canSend()` gate reads from here;
  [dispatch](../../../packages/services/DISPATCH.md) governs only fairness/rate).
* **Non-contacts** (e.g. a STOP from an unknown number) are covered by the **account-level
  block list** owned by the **account** service — a global, by-value do-not-contact list.
  The channel's `canSend()` checks both that block list and this per-contact suppression. An account
  preference can **auto-promote a contact's opt-out into that block list** for durable
  suppression (survives contact archival / re-import).
* Store/derive **timezone** (from address / area code) to support quiet-hours sending.

## Search
* **Not served from DynamoDB** (SoT, not indexable) — the search service indexes
  contacts, including `indexed` custom fields, with faceting + comparisons. Eventually
  consistent with the SoT.

## Data classification (PII vs non-PII)

The authoritative classification of contact fields — drives **GDPR/CCPA forget** (what's purged vs retained),
log/event hygiene (never emit PII), and the *no-PII-in-the-lake* / *contactId-only snapshot* rules elsewhere.

**Legend:** **PII** = identifies a person · **non-PII** = safe to retain/emit · **sensitive** = GDPR Art 9 /
CCPA "sensitive PI" (extra care) · *On forget*: **purge** (wipe value) · **retain** (kept — no personal data,
or kept as required proof).

| Field | Class | On GDPR/CCPA forget | Notes |
|---|---|---|---|
| `uuid` (contact id) | **non-PII** (opaque) | **retain** | the stable key analytics/messages/segments reference — the tombstone shell |
| `name` | **PII** | purge | |
| Emails (all) | **PII** | purge | value lowercased; if it was suppressed, opt-out **proof** lives in the account block-list (retained there), not the contact |
| Phones (all) | **PII** | purge | E.164; suppression proof same as email |
| Address (structured) | **PII** | purge | |
| `tz` (timezone) | **non-PII** (coarse, derived) | retain (or clear with address) | not identifying alone |
| `primaryLanguage` / `secondaryLanguage` | **non-PII** (locale/preference) | retain | |
| Link/URL · social handles | **PII** | purge | identifying |
| Notes (free-text) | **PII** (may contain anything) | purge | treat as PII regardless of content |
| External refs (customer id, list-company id) | **PII** (identifier) | purge | purged so the shell can't be re-linked |
| Custom-field values | **PII** — **may be sensitive** | purge | e.g. voter id; **may hold Art 9 / sensitive PI** (health, etc.) — the account is responsible; never *required* fields |
| Tags | **non-PII** label — **may imply sensitive** | retain (review) | account-defined; a tag can *infer* sensitive info (e.g. "diabetic") — review on forget |
| Consent / suppression state (per channel) | derived from a PII value | **retain minimal opt-out proof** | legal-obligation (TCPA/CAN-SPAM); the durable proof is the **account block-list** value + reason, not the purged contact |
| `createdAt/By`, `lastModifiedAt/By`, audit | metadata (references `uuid` only) | retain | carries no personal data after PII purge |
| Change-history records (field-level diffs) | **PII** (hold prior field *values*) | **purge values; retain `{who, when, field, version}`** | the append-only version log; purge old PII values on forget, keep who/when/field-name metadata for audit |

> **Special categories (GDPR Art 9 / CCPA sensitive PI)** can only arrive via **custom fields, tags, or
> notes** — never the system fields. Flag custom fields that may hold them, keep them **optional**, and apply
> the same purge-on-forget. (Health data also intersects the platform **PHI / HIPAA** decision — see
> [auth → Gaps](../auth/specs/SPECS.md).)

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
* **SQS "forget" responder (`contact`).** A Job consumes a typed `contact` "forget" request
  from SQS, produces the redacted tombstone above, **and fans the contact's known PII values**
  (every email / phone / name / address / external ref) **out to content-holding services**
  ([collab](../collab/SPECS.md) `/internal/erase` for room docs + chat,
  [campaign](../campaign/SPECS.md) for sent content, …) for **exact-match obfuscation** of any
  PII typed into free-text. Carrying the contact's *known* values lets each content scan match
  **exact strings, not blind patterns** — far more reliable than regex/DLP. (Auth runs the same
  responder for a `user` subject — `auth-21.5`.)

## Export
* Export contacts and segments to CSV (and other formats); **audit who/what/when**.
* Export a **single contact + its interactions** (joining referenced activity from
  messaging/analytics).

## Audit & change tracking
* Track `createdAt/By`, `lastModifiedAt/By` on every contact (who + when).
* **Field-level change history (versioned).** Every **create (POST) and update (PUT/PATCH)** of a contact (and
  its child objects — custom-field values, consent, tags) appends an **immutable version record**: **who** (the
  authenticated actor `uuid` — plus the *real* actor + on-behalf context for staff / sub-account impersonation),
  **when** (server timestamp), **source** (UI / API / import / sync — reusing the sync origin-stamp), the
  monotonic **`version`/etag**, and the **field-level diff** — `{ field, before, after }` for each changed field.
  The diff is computed **off the write path** from the DynamoDB **Streams** before/after images (the
  `ContactStreamJob` CDC bridge), so it's reliable (one record per committed write) and doesn't burden the API.
* **Compare + revert.** Because each version carries before/after per field, two versions can be **diffed**, and
  a field (or set of fields) **reverted** — a revert is a **new, audited change** that sets the field back to a
  prior value (history is **append-only**; nothing is rewritten), **optimistic-concurrency guarded**
  (`version`/etag) so it can't silently clobber a concurrent edit.
* **Bulk vs interactive.** Interactive create/update gets the **full field-level** history above. **Bulk import**
  records at **batch level + per-contact provenance** (the import batch id / list source) rather than a per-row
  field diff — **configurable** to expand — so a million-row import doesn't explode the change log.
* **PII in history is still PII.** Change records hold **prior field values** (names, emails, phones, …) — they
  are classified **PII**, encrypted at rest (SSE-KMS), and **purged on GDPR forget**: the tombstone purges the
  change-history *values* too, retaining only `{ who, when, field-name, version }` metadata — so the history can
  **never become a re-identification backdoor**. See the classification table.
* **Action-level audit** (export, forget, bulk ops, consent change, field-def change) is **emitted** via the
  shared **`Application.audit()`** to the central **[audit](../audit/SPECS.md)** service — **PII-light**
  (ids, not values) and **immutable**. This is **separate** from the field-level change history above (which is
  **co-located + PII-dense** and purges on forget): **audit records *that* it happened; change-history records
  *how the fields changed*.**

## Multi-tenancy & limits
* Strict account ownership + sub-account isolation (no parent visibility into contacts).
* Custom-field definitions support `self` and `inherit` modes (above): a parent pushes
  locked-down inherited fields; sub-accounts add their own.
* Plan-gated limits (max contacts, max custom fields) via `ResolvedEntitlements`.

# Compliance & standards mapping

How **this contact service's** surfaces map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (Security Rule, if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law**
(TCPA / CAN-SPAM / CASL — consent + suppression). Clause refs are **indicative**; this is a **design-intent**
self-assessment (certification is operating-effectiveness over time + an ISMS — beyond a spec). Contact is the
platform's **PII-densest** service, so **GDPR/CCPA** and **consent/suppression** dominate. There is **no PCI**
surface (no payment data). **HIPAA** is ➖ except where a customer puts health data into **custom fields / tags
/ notes** — prohibited by [AUP no-PHI](../account/specs/SPECS.md) (sensitive fields are flagged + kept
optional). Identity/RBAC live in [auth](../auth/specs/SPECS.md); suppression **enforcement at send** is the
**channel** (the `canSend()` gate reads consent/suppression from here; [dispatch](../../../packages/services/DISPATCH.md)
governs only fairness/rate); the no-cross-region posture is the
platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / residual · ➖ n/a

| Contact surface / control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging (TCPA/CAN-SPAM) | |
|---|---|---|---|---|---|---|---|---|
| **Tenant isolation** — account-owned, **sub-account isolation** (no parent visibility); DDB per-account partition | A01 | A.5.15 / A.8.3 | CC6.1 | §164.312(a)(1) | Art 32 | §1798.100 | ➖ | ✅ |
| **PII data classification** (authoritative table) — drives forget + log/event hygiene | A09 | A.5.12 / A.8.10 | CC6.x / Privacy | ➖ | Art 30 | §1798.130 | ➖ | ✅ |
| **GDPR/CCPA forget** — redacted tombstone (`uuid` retained, **all PII purged**), propagated to search + synced systems | A04 | A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ➖ | ✅ |
| **SQS forget responder** — tombstone + fan known-PII match-set to content services (exact-match obfuscation) | A04 | A.8.10 | (Privacy) | ➖ | Art 17 | §1798.105 | ➖ | ✅ |
| **Data export / access / portability** — contacts + segments to CSV, audited (who/what/when) | A01 | A.8.10 / A.8.15 | CC6.x | ➖ | Art 15 / 20 | §1798.110 / .130 | ➖ | ✅ |
| **Per-channel consent / opt-in + proof** (state, source, timestamp, proof) | A04 | A.5.34 | (Privacy) | ➖ | Art 6 / 7 | §1798.120 | TCPA / CAN-SPAM | ✅ |
| **Suppression** on the contact — **the channel verifies before send** (`canSend()`; dispatch governs fairness) | A04 | A.5.34 | CC6.x | ➖ | Art 21 | §1798.120 | TCPA / CAN-SPAM | ✅ enforced by channel |
| **Opt-out auto-promote → account block-list** (durable DNC, survives archive / re-import) | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | TCPA DNC | ✅ |
| **Sensitive PI (GDPR Art 9)** — only via custom fields / tags / notes; **flagged, optional, purged on forget** | ➖ | A.5.34 / A.8.10 | (Privacy) | §164.502 (AUP gate) | Art 9 | §1798.140 (sensitive) | ➖ | ⚠️ AUP no-PHI; account-responsible |
| **No PII in logs / change events** — downstream sees **opaque `contactId` only** | A09 | A.8.15 / A.8.16 | CC7.2 | §164.502(b) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Sync integrity** — outbound **HMAC-signed**, inbound **idempotent**, **loop prevention** (origin-stamped) | A08 | A.8.24 / A.5.23 | CC7.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Encryption** — in transit (TLS) + at rest (SSE-KMS) | A02 | A.8.24 | CC6.1 | §164.312(a)(2)(iv) | Art 32 | ➖ | ➖ | ✅ |
| **Audit & change tracking** — `createdAt/By` · `lastModifiedAt/By` + **versioned field-level change history** (who/when/diff, compare + revert); export + bulk ops audited; **history PII purges on forget** | A09 | A.8.15 | CC7.2 | §164.312(b) | Art 30 / 5(2) | ➖ | ➖ | ✅ |

# SQS listeners

> **Placeholder — platform convention.** Every service documents the **SQS queues it consumes** here: the
> **queue name**, the **message body** it expects, and the **handler/action** + requirement it satisfies.
> Message-body shapes will be pinned as shared **`Type` contracts in `@repo/common`** (so producer and consumer
> agree on the envelope); for now this table is the source of truth. Consumed via a `Job`/worker on the shared
> [`Application`](../../../packages/services/src/Application.ts) base (fair-share `WorkQueue` where applicable).

| Queue | Message body (TBD `Type`) | Handler / action | Req |
|---|---|---|---|
| `contact-forget` | `{ subjectType: "contact", contactUuid, pii: { emails[], phones[], names[], addresses[], externalRefs[], … } }` | **Forget responder** — produce the redacted contact tombstone, then fan the **known-PII match-set** out to content services ([collab](../collab/SPECS.md) `/internal/erase`, [campaign](../campaign/SPECS.md), …) for exact-match obfuscation | Archive & GDPR |
| *(future)* | *…* | *…* | *…* |

# Gaps & decisions

*The one review list — open decisions are merged here.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ⚠️ **Conflict resolution default.** Last-write-wins (by `lastModifiedAt`) vs **external-always-wins** when the
   CRM is the configured source of truth — pick the default (`contact-8.2`).
2. ✅ **Field-level change history — DECIDED: full per-field versioned trail with revert.** Every interactive
   create/update appends an **immutable version record** (who · when · source · `version` · per-field
   `{ before, after }` diff), computed **off the write path** from DynamoDB **Streams** images; two versions
   **diff** and a field **reverts** as a new optimistic-concurrency-guarded change. **Bulk import** logs at
   **batch level + provenance** (configurable). **History PII values purge on forget** (retain who/when/field-name
   metadata). This is a **platform pattern for primary objects**, not contact-only (`contact-13.3`–`13.6`).

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role** on both the
HTTP and worker sides. A **domain Service base** (`ContactService extends Service`) and a **domain Job base**
(`ContactJob extends Job`) hold the **shared domain code** — repository/DAO over the DDB tables, the
`ContactModel`, the account / sub-account **tenancy guard**, consent / suppression resolution, the
**change-history diff writer**, dedup, idempotency, config / secrets — so **every concrete role inherits it**.
Concrete **roles extend the domain base, never the framework base directly.** Assume specialized roles **will**
appear (read scaling, a new worker), so the base exists from day one even when there's a single role today.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── ContactService             (domain base — repo · tenancy · consent · model; not deployed alone)
│           ├── ContactMainService   (full read/write API · inbound webhooks · job enqueue · internal write S2S)
│           └── ContactReadService   (read-optimized: canSend() consent gate · contact fetch · list/search · history — scales independently)
└── Job (Lambda, event-driven)
      └── ContactJob                 (domain base — repo · change-history writer · dedup · idempotency · WorkQueue fair-share)
            ├── ContactImportJob     (SQS — CSV / vCard ingest)
            ├── ContactExportJob     (SQS — CSV / artifact export)
            ├── ContactForgetJob     (SQS contact-forget — tombstone + known-PII fan-out)
            ├── ContactSyncJob       (SQS — inbound CRM upsert: dedup / merge / conflict / loop-prevention)
            ├── ContactSegmentJob    (SQS — segment count-diff + membership snapshot)
            └── ContactStreamJob     (DDB Streams — emit contact.* to Kafka + write change-history diff + drive outbound sync)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`ContactService`** | `Service` | **Domain base** — shared repo / model / tenancy guard / consent resolution; **not deployed alone** (health-only if instantiated). |
| **`ContactMainService`** | `ContactService` | The primary service — full **read/write** REST (`/contact/*`), **inbound CRM webhooks**, **enqueue** handlers (import/export/forget → SQS), and **internal write S2S**. |
| **`ContactReadService`** | `ContactService` | **Read-optimized** role — the **hot `canSend()` consent / suppression gate** (`/internal/consent`), contact fetch, search-backed list, and **history reads**; **scales independently** (own replica count / autoscaling) on **read-only data access**. |

**Jobs (Lambda, event-driven)** — each extends `ContactJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`ContactImportJob`** | SQS (`POST /contact/imports`) | CSV/vCard ingest — map · normalize · dedup · write · per-row error report · progress; idempotent | contact-6.* |
| **`ContactExportJob`** | SQS (`POST /contact/exports`) | Async export to S3 (contacts / segments; single-contact + interactions); audited | contact-7.* |
| **`ContactForgetJob`** | SQS `contact-forget` | GDPR forget responder — tombstone + fan known-PII match-set to content services | contact-10.4 |
| **`ContactSyncJob`** | SQS (queued by the webhook handler) | Inbound CRM-change processing off the HTTP path — upsert / dedup / merge / conflict / loop-prevention | contact-8.*, 9.* |
| **`ContactSegmentJob`** | SQS (preview / refresh) | Segment evaluation against search — count-diff preview, membership snapshot + contact↔segment join | contact-4.3/4.5 |
| **`ContactStreamJob`** | **DynamoDB Streams** | CDC bridge — publish `contact.*` to Kafka (search + analytics), **write the field-level change-history diff**, drive outbound sync push | contact-11.2, 13.3 |

> **`ContactDedup`** (match-key + field-level survivorship) is a **shared module** used by `ContactImportJob`,
> `ContactSyncJob`, and the dedup/merge endpoints — not its own deployable. The bulk **duplicate-candidate scan**
> behind `GET /contact/duplicates` runs on-demand within `ContactSyncJob` (no separate Lambda until book sizes
> demand it).

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** (+ **Streams**) — the source of truth (`contacts`, `field_defs`, `segments`, `consent`, `import_jobs`, `import_maps`); external-id GSI; streams feed search/analytics.
* **S3** — import files (**presigned direct upload**, scanned before parse — see Import) + export artifacts.
* **SQS** — async import jobs (`contact-import`, post-scan) + the `contact-forget` responder queue.
* **Kafka** — `contact.*` change events to search + analytics.
* **KMS** — encryption at rest.

**Third-party libraries / services**
* **Salesforce / HubSpot** (and other CRMs) — bidirectional sync; the **connectors live in integrations/workflow**, contact exposes the sync API + webhooks.

**Internal (`@repo/*`)**
* `@repo/services` (Dynamo, S3, Sqs, Kafka, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`). **Search / segment evaluation** is delegated to the **search** service (OpenSearch).

# Requirements (traceable register)

The traceable requirement register for the **contact service** (the narrative `# Requirements` sections above
are the rationale; this is the coded list). IDs are stable handles (**`contact-N.M`**) — cite them in code,
tickets, and tests. **Priority:** **A** = MVP (ship first), **B** = core feature / hardening, **C** = later.
One level of sub-requirements only; a group's priority is its floor. **Boundaries:** contact owns **contacts +
PII, custom fields, segments, consent/suppression, import, sync metadata, archival + GDPR forget**;
**[search](../search/SPECS.md)** owns the index/eval at scale (DDB is SoT, not the query engine);
the **channel** *enforces* suppression at send (`canSend()`), **[dispatch](../../../packages/services/DISPATCH.md)** governs only fairness/rate; **integrations/workflow** own the CRM
*connectors* (contact exposes the sync API + webhooks); **[account](../account/specs/SPECS.md)** owns the block-list +
plan limits. **Segmentation stays in this service** (`contact-4.0`) — it shares the contact data model + search
backend, so it's a requirements group, not a separate service.

## contact-1.0 Contacts & PII — A
- **contact-1.1** Account-owned; **sub-account isolation** (a sub-account's contacts are not owned/visible to the parent) — A
- **contact-1.2** Identity — stable **`uuid`** (contact id) + name — A
- **contact-1.3** **Multiple emails**, each with context (`home`/`work`/`other`), **exactly one default**; normalized lowercased — A
- **contact-1.4** **Multiple phones**, each typed (`cell`/`work`/`home`/`other`), stored **E.164**, **exactly one default** — A
- **contact-1.5** Structured **address** + **`tz`** (derived from address / area code; drives quiet-hours) — A
- **contact-1.6** **`primaryLanguage`** + optional **`secondaryLanguage`** (BCP-47) — drives [campaign](../campaign/SPECS.md) variant select + language-gated skip; a segmentation dimension — B
- **contact-1.7** Link/URL, social handles, **notes** (free-text, first-class — not a custom field) — A
- **contact-1.8** Dedup **and** the channel's send check consider **ALL** of a contact's emails/phones, not just the default — A

## contact-2.0 Custom fields (typed, immutable, inheritable) — A
- **contact-2.1** **Plan-gated count** (50 default, ~200 high plan, ~250 hard cap) via `ResolvedEntitlements` — A
- **contact-2.2** Fixed **types** (`string`/`number`/`date`/`boolean`/`choice`/`multi_choice` + typed `email`/`phone`/`url`); **validated on write** — A
- **contact-2.3** **Type is immutable** — change = new field + migrate; old retired, never re-typed — A
- **contact-2.4** `choice`/`multi_choice` option sets are **add-only** (never re-typed); metadata: key, label, required?, default?, `indexed?` — B
- **contact-2.5** **`self` vs `inherit`** modes — inherited fields are read-only in sub-accounts + don't consume their budget — A
- **contact-2.6** **Soft delete** (retire/hide); existing values retained unless purged — B
- **contact-2.7** **Flag** custom fields that may hold **Art 9 / sensitive PI**; keep them **optional**, never required — A

## contact-3.0 Tags — B
- **contact-3.1** **System tags** — platform-applied, not user-editable (`bounced`, `engaged`, `imported`, …) — B
- **contact-3.2** **Account tags** — free-form labels the account defines/applies — B
- **contact-3.3** **Campaign tags** — applied by campaigns, carry originating **campaign id** (provenance) — B
- **contact-3.4** All three namespaces **queryable in segmentation** — B

## contact-4.0 Segmentation (the primary tool) — A
- **contact-4.1** A **Segment** = saved query (`eq`/`neq`/`contains`/`gt`/`lt`/`in`/`exists`/date-range) + boolean groups (AND/OR/NOT) over system + custom fields — A
- **contact-4.2** **Static, snapshotted membership** — live/auto-updating segments **deferred** (cost-control story) — A
- **contact-4.3** **Refresh is user-initiated, never silent** — show a **count diff** (would-add/remove), apply **only on explicit accept** — A
- **contact-4.4** **Sub-segments** (filter within a segment) — consumed by [campaign](../campaign/SPECS.md) — B
- **contact-4.5** **Contact ↔ segment join** — "what segments is this contact in?" is a direct lookup (explicit snapshot rows) — B
- **contact-4.6** **Exclusion segments** + size/count + preview; power campaign audience (campaign owns the send-time freeze, contact provides query + consent overlay) — A
- **contact-4.7** **Archivable, never deletable** — membership snapshot preserved so a past campaign always points at the exact set it sent to — A

## contact-5.0 Consent & suppression — A
- **contact-5.1** **Per-channel suppression** on the contact (`sms`/`email`/`voice`/…) — origin (STOP / manual / import / sync / complaint / bounce) + **source** + reason + timestamp — A
- **contact-5.2** **Per-channel consent (opt-in / opt-out)** — state (`opted_in`/`opted_out`/`unknown`/`pending`), **`source`** (where — captured for **both** opt-in and opt-out), timestamp, **proof** (TCPA) — A
- **contact-5.3** **The channel verifies suppression + consent before sending** (`canSend()` reads from here; dispatch governs fairness) — A
- **contact-5.4** **Non-contacts** → the **[account](../account/specs/SPECS.md) block-list** (global by-value DNC); the channel's `canSend()` checks both — A
- **contact-5.5** Account preference can **auto-promote an opt-out into the block-list** (durable — survives archive / re-import) — B
- **contact-5.6** Derive/store **timezone** for quiet-hours sending — B
- **contact-5.7** **Time-based precedence** — most recent `at` wins per channel; an **opt-in after an opt-out re-enables sending** (complaint / hard-bounce suppression excepted) — A

## contact-6.0 Import (CSV / vCard) — A
- **contact-6.1** Large **async ingest** — column→field **mapping**, normalization, **dedup mode** (skip/update/create) — A
- **contact-6.2** **Dry-run preview** — counts, sample, conflicts — B
- **contact-6.3** **Progress + completion notification**; partial-failure tolerated with a **downloadable per-row error report** — A
- **contact-6.4** **Provenance** — tag imported contacts with the import **batch id / list source** — B
- **contact-6.5** **Idempotent re-runs** — same batch doesn't double-create — A

## contact-7.0 Export — B
- **contact-7.1** Export **contacts + segments** to CSV (and other formats); **audit** who/what/when — B
- **contact-7.2** Export a **single contact + its interactions** (join referenced activity from messaging/analytics) — B
- **contact-7.3** Serves **GDPR Art 15/20 access + portability** / **CCPA access** for contact data — B

## contact-8.0 External IDs & sync — B
- **contact-8.1** **Multiple external refs** per contact (`{ salesforce, hubspot, listco, … }`) — **upsert-by-external-id** (GSI) + dedup — B
- **contact-8.2** **Source-of-truth config** per account (optionally per field); conflict = **LWW** or **external-always-wins** *(default — gap #1)* — B
- **contact-8.3** **Sync metadata** — `lastSyncAt` (per system), `sourceSystem`, `version`/etag (optimistic concurrency) — B
- **contact-8.4** **Webhooks** — inbound idempotent (dedupe by external event id), outbound **HMAC-signed** (auth spec) — B
- **contact-8.5** **Loop prevention** — origin-stamp each change; never echo a change back to its source; guard sync storms — B
- **contact-8.6** Connectors owned by **integrations/workflow**; contact only **exposes the sync API + webhooks** — B
- **contact-8.7** **Target CRM connectors** (see *External IDs & sync → Target CRM integrations*): first wave
  **HubSpot CRM** + **Zoho CRM** (both free-tier, general); nonprofit/donor CRMs **Bloomerang · DonorPerfect ·
  Little Green Light · Neon CRM · Kindful** (constituent ⇄ Contact; donor fields as custom fields; giving
  history stays in the external SoT). Each is an `ExternalRef` system key; reuse import maps for the initial
  import + the sync config/webhooks for ongoing bidirectional flow — B

## contact-9.0 Dedup & merge — B
- **contact-9.1** Match keys — email, normalized phone, any external id; rules **configurable** — B
- **contact-9.2** On collision — skip / update / **merge** with **field-level survivorship**; **manual merge** for ambiguous; runs on **import + sync** — B

## contact-10.0 Privacy, classification & GDPR — A
- **contact-10.1** The **PII classification table** is authoritative — drives forget (purge vs retain), log/event hygiene, no-PII-in-the-lake — A
- **contact-10.2** **Archive, never hard-delete** — soft `isDeleted` + `deletedAt/By`, excluded from segments/search, **restorable**, retained — A
- **contact-10.3** **GDPR forget = redacted tombstone** — retain `uuid` shell, **irreversibly purge all PII**, mark `gdprForgotten` + `forgottenAt/By` + reason; propagate to search + (per config) synced systems — A
- **contact-10.4** **SQS `contact` forget responder** — tombstone + fan the **known-PII match-set** out to content services ([collab](../collab/SPECS.md) `/internal/erase`, [campaign](../campaign/SPECS.md), …) for exact-match obfuscation — B
- **contact-10.5** **Sensitive PI (Art 9)** only via custom fields / tags / notes — flag, keep optional, purge on forget; intersects the **PHI/HIPAA** AUP no-PHI decision — A

## contact-11.0 Data model, storage & search — A
- **contact-11.1** **DynamoDB is the SoT** — per-account partitioned (`PK accountId` / `SK contactId`); **not** the query engine — A
- **contact-11.2** **Search/segmentation via [search](../search/SPECS.md)** (OpenSearch), fed by `contact.*` change events; **eventually consistent** (note the lag) — A
- **contact-11.3** **External-id GSI** (`system#externalId → contactId`) for sync upsert + dedup — A
- **contact-11.4** **Item-size caution** — 400 KB DDB limit (notes + wide custom fields); overflow handling, **flag don't truncate** — B

## contact-12.0 Multi-tenancy & limits — A
- **contact-12.1** Strict account ownership + **sub-account isolation** (no parent visibility into contacts) — A
- **contact-12.2** Custom-field **`self`/`inherit`** modes (parent pushes locked inherited fields; sub-accounts add their own) — A
- **contact-12.3** **Plan-gated limits** (max contacts, max custom fields) via `ResolvedEntitlements` — A

## contact-13.0 Audit & change tracking — B
- **contact-13.1** `createdAt/By`, `lastModifiedAt/By` on every contact (who + when) — A
- **contact-13.2** **Emit action-level audit events** (export, forget, bulk ops, consent change, field-def change) via shared **`Application.audit()`** → central **[audit](../audit/SPECS.md)** service (PII-light, immutable); **distinct** from the field-level change-history below — B
- **contact-13.3** **Field-level change history (versioned)** — every interactive **create (POST) / update (PUT/PATCH)** appends an **immutable version record**: **who** (actor `uuid` + real-actor / on-behalf context), **when**, **source** (UI/API/import/sync), monotonic **`version`/etag**, and a per-field **`{ field, before, after }` diff**; computed **off the write path** from DDB **Streams** images (the `ContactStreamJob` CDC bridge) *(gap #2)* — B
- **contact-13.4** **Compare + revert** — diff any two versions; **revert** a field / set to a prior value as a **new audited change** (append-only history), **optimistic-concurrency guarded** (`version`/etag) — B
- **contact-13.5** **Bulk = batch-level** — import logs **batch id + provenance** per contact, not a per-row field diff (configurable to expand) — B
- **contact-13.6** **History PII purges on forget** — change records are **PII** (prior values); on GDPR forget purge the **values**, retain `{ who, when, field, version }` metadata; encrypted at rest (SSE-KMS) — A

## contact-14.0 Service & Job topology — B
- **contact-14.1** **Domain bases** — `ContactService extends Service` + `ContactJob extends Job` hold the shared domain code (repo · tenancy guard · consent resolution · change-history diff writer · dedup · idempotency); **concrete roles extend the domain base, not the framework base** — B
- **contact-14.2** **`ContactMainService`** — full read/write `/contact/*` API + inbound webhooks + job enqueue + internal write S2S — A
- **contact-14.3** **`ContactReadService`** — read-optimized role (the `canSend()` consent gate, contact fetch, list/search, history reads); **scales independently** on **read-only** data access — B
- **contact-14.4** **Jobs extend `ContactJob`** — `ContactImportJob` / `ContactExportJob` / `ContactForgetJob` / `ContactSyncJob` / `ContactSegmentJob` / `ContactStreamJob`, each a Lambda on the shared base — A
- **contact-14.5** **`ContactStreamJob` (DDB Streams)** — emit `contact.*` to Kafka (search + analytics) **and** write the field-level **change-history diff** (`contact-13.3`) — A
- **contact-14.6** **`ContactDedup` shared module** — match-key + field-level survivorship, reused by import / sync / merge (not a deployable); bulk duplicate scan runs within `ContactSyncJob` — B

## contact-15.0 Address verification (provider-based, marketplace) — B
- **contact-15.1** **Provider FACTORY for address verification / standardization** — a pluggable adapter
  interface (same shape as other provider factories: one adapter per vendor, a `fake` for tests) that
  **validates + standardizes** a structured address (CASS/USPS-style correction, delivery-point validation,
  optional **geocode** → lat/lon), returning a normalized result + a **confidence / status**
  (`verified` / `corrected` / `unverifiable`). Providers: **USPS** (US CASS), **Smarty** (US + international),
  **Google** (Address Validation / Geocoding), **Geoapify** (geocoding + validation), **Melissa** (global
  address verification + geocoding + data quality). — B
- **contact-15.2** **Marketplace items** — each verification provider is a **[marketplace](../marketplace/SPECS.md)
  installable**, configured per account; the account enables which provider(s) to use. Not built-in/default —
  installed + credentialed (Secrets Manager) like other marketplace connectors. — B
- **contact-15.3** **Plan-tiered usage** — verification is **metered**; a **basic allowance depends on the
  account plan** ([account entitlements](../account/specs/SPECS.md)), with overage/upgrade beyond it (cost
  accounting emitted to billing). Gate calls against the plan's allowance before invoking a paid provider. — B
- **contact-15.4** **Verify on demand + on import** — verify a single address (edit form), in **bulk at import**
  (contact-6), or re-verify on change; persist the normalized address + the verification `status` + `verifiedAt`
  + provider on the contact's address (re-editable, non-destructive — keep the original alongside the
  correction until accepted). — B
- **contact-15.5** **Geocode → `lat`/`lon`** — when the provider returns coordinates, store them on the address
  (feeds map / segment-by-radius + the `tz` derivation, `contact-1.5`). — C

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/contact/*`**; the contact resource is **`/contact/contacts/{id}`** (explicit collection to
avoid colliding with `segments` / `fields` / `imports`). Reads return the `{ data, page }` envelope; **list /
search is served from [search](../search/SPECS.md)** (eventually consistent), not DynamoDB.

**Access column:** recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
step-up · **`Internal`** = VPC-only S2S · **`Webhook-sig`** = signature-verified inbound. A senior role satisfies
any junior minimum.

### Contacts — CRUD + related objects (contact-1, contact-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/contacts` | List / search contacts (via search; filters, facets, paging) | USER | contact-11.2 |
| POST | `/contact/contacts` | Create a contact | USER | contact-1.1/1.3/1.4 |
| GET | `/contact/contacts/{id}` | Get a contact (full profile) | USER | contact-1.2 |
| PATCH | `/contact/contacts/{id}` | Update fields (emails/phones/address/lang/custom/notes) | USER | contact-1.x |
| DELETE | `/contact/contacts/{id}` | **Soft archive** (never hard-delete); restorable | USER | contact-10.2 |
| POST | `/contact/contacts/{id}/restore` | Restore an archived contact | USER | contact-10.2 |
| POST | `/contact/contacts/{id}/forget` | **GDPR forget** — enqueue the redacted-tombstone job (audited) | ACCOUNT ⬆ | contact-10.3 |
| GET | `/contact/contacts/{id}/history` | **Field-level change history** — version list (who / when / source / changed fields) | USER | contact-13.3 |
| GET | `/contact/contacts/{id}/history/{version}` | A specific version — full per-field `{ before, after }` diff | USER | contact-13.3 |
| POST | `/contact/contacts/{id}/revert` | **Revert** field(s) to a prior version — a new audited change (`version`-guarded) | USER | contact-13.4 |
| GET | `/contact/contacts/{id}/segments` | Segments this contact belongs to | USER | contact-4.5 |
| GET | `/contact/contacts/{id}/external-refs` | External-id mappings for this contact | USER | contact-8.1 |
| GET | `/contact/contacts/{id}/export` | Single contact + its interactions (Art 15/20) | USER | contact-7.2 |

### Custom field definitions (contact-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/fields` | List custom-field definitions (`self` + inherited) | USER | contact-2.5 |
| POST | `/contact/fields` | Create a definition (fixed type; `self`/`inherit`) | ACCOUNT | contact-2.2/2.5 |
| PATCH | `/contact/fields/{id}` | Edit label / **add** options (never re-type) | ACCOUNT | contact-2.3/2.4 |
| DELETE | `/contact/fields/{id}` | **Soft retire** (values retained unless purged) | ACCOUNT | contact-2.6 |

### Tags (contact-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/tags` | List tags (system / account / campaign namespaces) | USER | contact-3.4 |
| POST | `/contact/tags` | Create an **account** tag | ACCOUNT | contact-3.2 |
| POST | `/contact/contacts/{id}/tags` | Apply tag(s) to a contact | USER | contact-3.2 |
| DELETE | `/contact/contacts/{id}/tags/{tag}` | Remove a tag from a contact | USER | contact-3.2 |

### Segments (contact-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/segments` | List segments | USER | contact-4.1 |
| POST | `/contact/segments` | Create a segment (saved query; optional `sort` + `limit`) | USER | contact-4.1 |
| GET | `/contact/segments/{id}` | Get a segment + current size | USER | contact-4.6 |
| PATCH | `/contact/segments/{id}` | Edit the query / sort / limit | USER | contact-4.1 |
| POST | `/contact/segments/preview` | **Preview an (unsaved) query** — match count + sample, honoring `sort`+`limit` (in-service eval) *(implemented)* | USER | contact-4.3 |
| POST | `/contact/segments/{id}/preview` | **Count diff** (would-add / would-remove) + sample | USER | contact-4.3 |
| POST | `/contact/segments/{id}/refresh` | **User-accepted** refresh — apply new membership | USER | contact-4.3 |
| GET | `/contact/segments/{id}/members` | Membership snapshot (paged) | USER | contact-4.5 |
| POST | `/contact/segments/{id}/archive` | Archive (never delete; snapshot preserved) | USER | contact-4.7 |

### Consent & suppression (contact-5)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/contacts/{id}/consent` | Per-channel consent + suppression state | USER | contact-5.1/5.2 |
| PUT | `/contact/contacts/{id}/consent` | Set consent / opt-in / suppression (with source + proof) | USER | contact-5.2 |

### Import / Export (contact-6, contact-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/contact/imports` | Start an import job (presigned CSV/vCard upload; mapping; dedup mode; `dryRun`) | USER | contact-6.1/6.2 |
| GET | `/contact/imports/{id}` | Import job status / progress | USER | contact-6.3 |
| GET | `/contact/imports/{id}/errors` | Download the per-row error report | USER | contact-6.3 |
| POST | `/contact/exports` | Start an export (contacts / segments → CSV); audited | ACCOUNT | contact-7.1 |
| GET | `/contact/exports/{id}` | Export status + download link | ACCOUNT | contact-7.1 |

### Import maps (contact-6) — reusable column→field maps *(implemented)*
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/importmaps` | List account + system maps (paged; `status`/`target`/`scope` filters) | USER | contact-6.4 |
| GET | `/contact/importmaps/{id}` | Get one map (account or system) | USER | contact-6.4 |
| POST | `/contact/importmaps` | Create an account map | ACCOUNT | contact-6.4 |
| PATCH | `/contact/importmaps/{id}` | Edit an account map (403 on system map) | ACCOUNT | contact-6.4 |
| DELETE | `/contact/importmaps/{id}` | Soft-delete an account map (403 on system map) | ACCOUNT | contact-6.4 |
| POST | `/contact/importmaps/{id}/copy` | Copy a system/account map into the account | ACCOUNT | contact-6.4 |

### Dedup & merge (contact-9)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/duplicates` | Candidate duplicate sets (by email / phone / external id) | USER | contact-9.1 |
| POST | `/contact/merge` | Merge contacts with field-level survivorship | USER | contact-9.2 |

### Sync — external CRM (contact-8)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/contact/sync/upsert` | Upsert-by-external-id (from connectors / integrations) | Internal | contact-8.1 |
| POST | `/contact/webhooks/{system}` | Inbound CRM change webhook (idempotent, origin-stamped) | Webhook-sig | contact-8.4/8.5 |

### Internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/contact/internal/consent` | **The channel reads** consent + suppression before send — the `canSend()` gate (bulk) | Internal | contact-5.3 |
| GET | `/contact/internal/contacts/{id}` | S2S contact fetch (sending / rendering) | Internal | contact-1.2 |
| GET, PUT | `/contact/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | contact-11.1 |
| GET | `/contact/health` | Liveness / readiness | - | contact-11.1 |

> **GDPR forget is SQS-driven** (`contact-forget`, see *SQS listeners*) — `POST /contact/contacts/{id}/forget`
> just **enqueues** the request; the responder job produces the tombstone + fans the known-PII match-set out.

# eof
