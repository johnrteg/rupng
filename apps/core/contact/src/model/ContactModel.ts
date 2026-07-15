//
// Contact domain model — the light-CRM: contacts + PII, custom fields, tags,
// segments, per-channel consent/suppression, import/export, CRM sync, archival
// + GDPR forget.
//
// Everything is scoped under the `Contact` namespace, so call sites read clearly:
//   Contact.Record, Segment.Entity, Contact.CustomFieldDef, Contact.ImportJob, ...
//
// Sourced from elsewhere (single source of truth):
//   * scalar primitives (UUID, Email, PhoneE164, ISODateTime, TimeZone, Url, Json)
//     -> `Type` in @repo/common
//
// Storage (see specs/SPECS.md):
//   * DynamoDB is the SoT — contacts  PK: accountId  SK: contactId;
//     external-id GSI (`system#externalId -> contactId`) for sync upsert + dedup.
//   * Search / segmentation runs against the search service (OpenSearch), fed by
//     `contact.*` change events — eventually consistent.
//
// IDs cite the traceable register (contact-N.M).
//

import type { Type } from "@repo/common";

export namespace Contact
{
    /** BCP-47 locale tag, e.g. "en-US" / "es-ES" (contact-1.6). */
    export type Locale = string;

    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    export enum EmailContext { HOME = "home", WORK = "work", OTHER = "other" }                       // contact-1.3
    export enum PhoneType    { CELL = "cell", WORK = "work", HOME = "home", OTHER = "other" }          // contact-1.4
    export enum AddressType  { HOME = "home", WORK = "work", OTHER = "other" }                          // contact-1.5

    /** Fixed custom-field type — immutable after definition (contact-2.2 / 2.3). */
    export enum CustomFieldType
    {
        STRING       = "string",
        NUMBER       = "number",
        DATE         = "date",
        BOOLEAN      = "boolean",
        CHOICE       = "choice",         // single
        MULTI_CHOICE = "multi_choice",
        EMAIL        = "email",
        PHONE        = "phone",
        URL          = "url",
    }

    /** self = (sub-)account-owned · inherit = parent-defined, read-only below (contact-2.5). */
    export enum CustomFieldMode { SELF = "self", INHERIT = "inherit" }

    export enum TagNamespace { SYSTEM = "system", ACCOUNT = "account", CAMPAIGN = "campaign" }         // contact-3

    /** Channel for consent/suppression — extensible (contact-5). */
    export enum Channel { SMS = "sms", EMAIL = "email", VOICE = "voice" }

    export enum ConsentState { OPTED_IN = "opted_in", OPTED_OUT = "opted_out", UNKNOWN = "unknown", PENDING = "pending" }   // contact-5.2

    export enum SuppressionOrigin                                                                      // contact-5.1
    {
        STOP_REPLY = "stop_reply",
        MANUAL     = "manual",
        IMPORT     = "import",
        CRM_SYNC   = "crm_sync",
        COMPLAINT  = "complaint",
        HARD_BOUNCE = "hard_bounce",
    }

    /** Data classification — drives forget (purge vs retain) + log hygiene (contact-10.1). */
    export enum PiiClass { PII = "pii", NON_PII = "non_pii", SENSITIVE = "sensitive" }

    export enum DedupMode    { SKIP = "skip", UPDATE = "update", CREATE = "create" }                   // contact-6.1
    export enum ImportStatus { PENDING = "pending", PROCESSING = "processing", COMPLETE = "complete", PARTIAL = "partial", FAILED = "failed" }  // contact-6.3
    export enum ExportTarget { CONTACTS = "contacts", SEGMENTS = "segments", CONTACT = "contact" }     // contact-7
    export enum ExportFormat { CSV = "csv", JSON = "json", VCARD = "vcard" }
    export enum ExportStatus { PENDING = "pending", PROCESSING = "processing", COMPLETE = "complete", FAILED = "failed" }

    // Lifecycle status — prefer an enumerated `status` over scattered booleans (archived/retired/deleted).
    export enum ContactStatus { ACTIVE = "active", ARCHIVED = "archived", FORGOTTEN = "forgotten" }   // contact-10
    export enum SegmentStatus { ACTIVE = "active", INACTIVE = "inactive", ARCHIVED = "archived" }      // contact-4.7
    export enum FieldStatus   { ACTIVE = "active", RETIRED = "retired" }                               // contact-2.6

    /** Sync conflict resolution (contact-8.2 / gap #1). */
    export enum SyncConflictPolicy { LAST_WRITE_WINS = "last_write_wins", EXTERNAL_WINS = "external_wins" }

    /** Segment query comparators + boolean operators (contact-4.1). */
    export enum Comparator { EQ = "eq", NEQ = "neq", CONTAINS = "contains", GT = "gt", GTE = "gte", LT = "lt", LTE = "lte", IN = "in", EXISTS = "exists", BETWEEN = "between" }
    export enum BoolOp     { AND = "and", OR = "or", NOT = "not" }

    // ──────────────────────────────────────────────────────────────────────────
    // Value objects
    // ──────────────────────────────────────────────────────────────────────────

    /** Common to the multi-valued contact attributes — exactly one per list is the default. */
    export interface ContactEntry { isDefault: boolean; verified?: boolean; }

    /** One of many emails (contact-1.3). */
    export interface EmailEntry extends ContactEntry { value: Type.Email; context: EmailContext; }

    /** One of many phones, E.164 (contact-1.4). */
    export interface PhoneEntry extends ContactEntry { value: Type.PhoneE164; type: PhoneType; }

    /** One of many addresses (contact-1.5). */
    export interface AddressEntry extends ContactEntry
    {
        type:        AddressType;
        line1?:      string;
        line2?:      string;
        city?:       string;
        region?:     string;   // state / province
        postalCode?: string;
        country?:    string;   // ISO 3166-1 alpha-2
        latitude?:   number;
        longitude?:  number;
        timeZone?:   Type.TimeZone;   // tz for this address — drives quiet-hours (contact-1.5 / 5.6)
    }

    export interface SocialHandle { platform: string; handle: string; url?: Type.Url; }

    /** The value of a source ref — always an **object**; **`id`** (the record's id in that system) is required,
     *  the rest optional + extensible (`lastSync`, …). */
    export interface ExternalRef { id: string; lastSync?: Type.ISODateTime; }

    /**
     * `sourceKey -> ref` — the **sync match-back + dedup** map (contact-8.1). An object/record, so a contact
     * links to **many sources** at once; every value is an `ExternalRef`.
     *
     * **Key** = the source: **`system`** for a single connection, or **`system:<context>`** to separate
     * **multiple occurrences of the same system** per account (marketplace `multiInstance` — two Shopify stores,
     * two Salesforce orgs). **`<context>` is optional** — a **UUID** (e.g. the marketplace connection id) **or**
     * a **label** (`sales`, `eu`).
     *   `{ zapier:               { id: "lfddfu-reorhelnfl" },               // single connection
     *      "shopify:sales":       { id: "gid://…/77", lastSync: "2026-…" }, // labelled context
     *      "shopify:7f3a-9c2e-…": { id: "gid://…/88" } }`                   // UUID context (the connection id)
     *
     *   GSI: `sourceKey#id -> contactId` (`sourceKey` = the map key) — match an inbound sync record from a
     *   specific connection back to the right contact.
     */
    export interface ExternalRefs { [sourceKey: string]: ExternalRef; }

    /** Typed custom-field value (validated against its definition's type — contact-2.2). */
    export type CustomFieldValue = string | number | boolean | Array<string> | null;
    export interface CustomFieldValues { [key: string]: CustomFieldValue; }

    /**
     * Per-channel consent event — `proof` retained for TCPA (contact-5.2).
     * `source` records *where* it happened (form / keyword / import / API / agent) — captured for **both**
     * opt-in and opt-out (`state`).
     * `at` is authoritative for **time-based precedence**: the effective state per channel is the
     * record with the **latest `at`** — so an `opted_in` dated *after* an `opted_out` re-enables sending.
     * (Exception: complaint / hard-bounce suppression is a separate hard block, not cleared by a later opt-in.)
     */
    export interface ConsentRecord { channel: Channel;
                                    state: ConsentState;
                                    source?: string;
                                    at: Type.ISODateTime;
                                    proof?: string; }

    /**
     * Per-channel suppression — how a contact came to be suppressed (contact-5.1).
     * `origin` = the category; `source` = the specific provenance (which keyword / form / campaign / agent).
     */
    export interface SuppressionRecord { channel: Channel; suppressed: boolean; origin: SuppressionOrigin; source?: string; reason?: string; at: Type.ISODateTime; }

    /** A tag in one of the three namespaces; campaign tags carry provenance (contact-3.3). */
    export interface Tag { namespace: TagNamespace; value: string; campaignId?: Type.UUID; }

    /** Who/when (contact-13.1). */
    export interface AuditMeta { createdAt: Type.ISODateTime;
                                createdBy: Type.UUID;
                                modifiedAt: Type.ISODateTime;
                                modifiedBy: Type.UUID; }

    /** Soft-archive metadata (contact-10.2). */
    export interface Archived { at: Type.ISODateTime; by: Type.UUID; }

    /** GDPR forget tombstone metadata (contact-10.3). */
    export interface Forgotten { at: Type.ISODateTime; by: Type.UUID; reason?: string; }

    /** Sync bookkeeping + optimistic-concurrency token (contact-8.3). */
    export interface SyncMeta { sourceSystem?: string;
                            lastSyncAt?: { [system: string]: Type.ISODateTime };
                            version: number;
                            etag?: string; }

    // ──────────────────────────────────────────────────────────────────────────
    // Contact (the resource)
    //   DynamoDB: contacts  PK: accountId  SK: contactId   GSI: system#externalId -> contactId
    // ──────────────────────────────────────────────────────────────────────────

    export interface Record
    {
        uuid:        Type.UUID;          // the contact id (contact-1.2)
        accountId:   Type.UUID;

        firstName?:  string;
        lastName?:   string;
        emails:      Array<EmailEntry>;       // contact-1.3
        phones:      Array<PhoneEntry>;       // contact-1.4
        addresses?:  Array<AddressEntry>;     // contact-1.5
        tz?:         Type.TimeZone;      // drives quiet-hours sending (contact-1.5 / 5.6)

        primaryLanguage?:   Locale;      // contact-1.6
        secondaryLanguage?: Locale;

        link?:       Type.Url;
        social?:     Array<SocialHandle>;
        notes?:      string;             // free-text, first-class — treat as PII (contact-1.7)

        customFields?: CustomFieldValues;  // contact-2
        tags?:         Array<Tag>;              // contact-3
        externalRefs?: ExternalRefs;       // contact-8.1 — { sourceKey: { id, lastSync? } }, many sources

        consent?:      Array<ConsentRecord>;      // contact-5.2
        suppression?:  Array<SuppressionRecord>;  // contact-5.1

        segmentIds?:   Array<Type.UUID>;        // contact ↔ segment join — "what segments is this contact in?" (contact-4.5)

        audit:         AuditMeta;          // contact-13.1
        sync?:         SyncMeta;           // contact-8.3

        // ── lifecycle / privacy (contact-10) ──
        status:           ContactStatus;   // active | archived | forgotten
        archived?:        Archived;         // when ARCHIVED — soft, restorable (contact-10.2)
        forgotten?:       Forgotten;        // when FORGOTTEN — redacted tombstone (contact-10.3)
    }

    /** Create payload — server assigns `uuid` / `accountId` / `audit` / lifecycle flags. */
    export type CreateContact = Omit<Record,
        "uuid" | "accountId" | "audit" | "sync" |
        "status" | "archived" | "forgotten">;

    /** Update payload — any subset of the createable fields. */
    export type UpdateContact = Partial<CreateContact>;

    /** PUT consent — replace per-channel consent + suppression (contact-5.2). */
    export interface ConsentUpdate { consent?: Array<ConsentRecord>;
                                    suppression?: Array<SuppressionRecord>; }

    // ──────────────────────────────────────────────────────────────────────────
    // Custom field definition
    //   DynamoDB: field_defs  PK: accountId  SK: fieldId
    // ──────────────────────────────────────────────────────────────────────────

    export interface ChoiceOption { key: string; label: string; }

    export interface CustomFieldDef
    {
        id:            Type.UUID;
        accountId:     Type.UUID;
        key:           string;
        label:         string;
        type:          CustomFieldType;    // IMMUTABLE after creation (contact-2.3)
        mode:          CustomFieldMode;    // self | inherit (contact-2.5)
        ownerAccountId: Type.UUID;         // for `inherit`: the defining parent
        required?:     boolean;
        defaultValue?: CustomFieldValue;
        indexed?:      boolean;            // surfaced to search (contact-2.4)
        options?:      Array<ChoiceOption>;     // choice/multi_choice — ADD-ONLY (contact-2.4)
        sensitive?:    boolean;            // flag potential Art 9 / sensitive PI (contact-2.7)
        status:        FieldStatus;        // active | retired (soft delete — contact-2.6)
        audit:         AuditMeta;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Segmentation (the primary tool) — contact-4
    //   DynamoDB: segments  PK: accountId  SK: segmentId
    // ──────────────────────────────────────────────────────────────────────────

    export interface Condition { field: string;
                                comparator: Comparator;
                                value?: Type.Json;
                                values?: Array<Type.Json>; }
    export interface Group     { op: BoolOp; conditions: Array<Condition | Group>; }
    /** Root boolean group of the saved query (contact-4.1). */
    export type Query = Group;

    export interface Segment
    {
        id:                    Type.UUID;
        accountId:             Type.UUID;
        name:                  string;
        query:                 Query;
        isExclusion?:          boolean;          // exclusion segment (contact-4.6)
        size?:                 number;           // current snapshot size
        membershipSnapshotAt?: Type.ISODateTime; // STATIC, snapshotted membership (contact-4.2)
        status:                SegmentStatus;    // active | inactive | archived (never deletable — contact-4.7)
        audit:                 AuditMeta;
    }

    /** Count-diff shown before a user-accepted refresh (contact-4.3). */
    export interface SegmentRefreshPreview
    {
        segmentId:   Type.UUID;
        currentSize: number;
        wouldAdd:    number;
        wouldRemove: number;
        nextSize:    number;
        sample?:     Array<Type.UUID>;   // sample of affected contact ids
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Import (CSV / vCard) — contact-6
    //   DynamoDB: import_jobs  PK: accountId  SK: importId
    // ──────────────────────────────────────────────────────────────────────────

    export interface ImportMapping { column: string; field: string; }   // column → field (contact-6.1)

    export interface ImportProgress { total: number;
                                    processed: number;
                                    created: number;
                                    updated: number;
                                    skipped: number;
                                    failed: number; }

    export interface ImportJob
    {
        id:              Type.UUID;
        accountId:       Type.UUID;
        status:          ImportStatus;
        source?:         string;             // file name / list source
        batchId:         Type.UUID;          // provenance tag on imported contacts (contact-6.4)
        mapping:         Array<ImportMapping>;
        dedupMode:       DedupMode;
        dryRun:          boolean;            // preview run (contact-6.2)
        progress?:       ImportProgress;     // contact-6.3
        errorReportUrl?: Type.Url;           // downloadable per-row errors (contact-6.3)
        audit:           AuditMeta;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Export — contact-7
    // ──────────────────────────────────────────────────────────────────────────

    export interface ExportJob
    {
        id:          Type.UUID;
        accountId:   Type.UUID;
        target:      ExportTarget;
        format:      ExportFormat;
        status:      ExportStatus;
        segmentId?:  Type.UUID;     // when target = SEGMENTS
        contactId?:  Type.UUID;     // when target = CONTACT (single + interactions, contact-7.2)
        downloadUrl?: Type.Url;
        audit:       AuditMeta;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Dedup & merge — contact-9
    // ──────────────────────────────────────────────────────────────────────────

    export interface DuplicateSet { matchKey: string; contactIds: Array<Type.UUID>; }   // candidate dupes (contact-9.1)

    export interface MergeRequest
    {
        accountId:         Type.UUID;
        survivorId:        Type.UUID;                       // the contact kept
        mergedIds:         Array<Type.UUID>;                // archived into the survivor
        fieldSurvivorship?: { [field: string]: Type.UUID }; // field → which contact wins (contact-9.2)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // GDPR forget — the SQS `contact-forget` message (see SPECS.md "SQS listeners")
    // The known-PII match-set is fanned to content services for exact-match obfuscation.
    // ──────────────────────────────────────────────────────────────────────────

    export interface ForgetRequest
    {
        subjectType: "contact";
        accountId:   Type.UUID;
        contactUuid: Type.UUID;
        requestedBy: Type.UUID;
        reason?:     string;
        pii: {
            emails?:       Array<Type.Email>;
            phones?:       Array<Type.PhoneE164>;
            names?:        Array<string>;
            addresses?:    Array<string>;
            externalRefs?: Array<string>;
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Data classification artifact (contact-10.1) — authoritative field → class map,
    // drives purge-vs-retain on forget. (Reference; not a wire object.)
    // ──────────────────────────────────────────────────────────────────────────

    export interface FieldClassification { field: string; class: PiiClass;
                                        purgeOnForget: boolean; note?: string; }
}

export default Contact;
// eof
