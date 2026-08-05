//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// Contact — the shared **wire contract** for the contact domain (the light-CRM): a contact + its PII, tags,
// per-channel consent/suppression, and the Segment (the primary targeting tool). Defined ONCE here so every
// contact endpoint + the service + web + campaign (audience) import the same canonical shapes.
//
// This is an INITIAL cut of the fuller domain design in apps/core/contact/SPECS.md — custom-field defs,
// import/export jobs, dedup/merge, and CRM sync are modeled by the spec but omitted here until those
// subsystems land. Scalars come from @repo/common's `Type`.
//
// Storage (see SPECS.md): DynamoDB is the SoT — contacts PK: accountId SK: contactId; segments PK: accountId
// SK: segmentId. Segmentation/search runs against the search service, fed by `contact.*` change events.
//
export namespace Contact
{
    /** BCP-47 locale tag, e.g. "en-US" / "es-ES". */
    export type Locale = string;

    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    export enum EmailContext { HOME = "home", WORK = "work", OTHER = "other" }
    export enum PhoneType    { CELL = "cell", WORK = "work", HOME = "home", OTHER = "other" }
    export enum AddressType  { HOME = "home", WORK = "work", OTHER = "other" }

    /** Biological sex (voter-file / demographic). `unknown` when not supplied. */
    export enum Sex { MALE = "male", FEMALE = "female", UNKNOWN = "unknown" }

    /** Political party affiliation (US-centric voter data; extensible). */
    export enum PoliticalParty
    {
        DEMOCRATIC  = "democratic",
        REPUBLICAN  = "republican",
        INDEPENDENT = "independent",
        GREEN       = "green",
        LIBERTARIAN = "libertarian",
        OTHER       = "other",
        UNKNOWN     = "unknown",
    }

    export enum TagNamespace { SYSTEM = "system", ACCOUNT = "account", CAMPAIGN = "campaign" }

    /** Channel for consent/suppression — extensible. */
    export enum Channel { SMS = "sms", EMAIL = "email", VOICE = "voice", PRINT = "print" }

    export enum ConsentState { OPTED_IN = "opted_in", OPTED_OUT = "opted_out", UNKNOWN = "unknown", PENDING = "pending" }

    export enum SuppressionOrigin
    {
        STOP_REPLY  = "stop_reply",
        MANUAL      = "manual",
        IMPORT      = "import",
        CRM_SYNC    = "crm_sync",
        COMPLAINT   = "complaint",
        HARD_BOUNCE = "hard_bounce",
    }

    /** Contact lifecycle — prefer an enumerated status over scattered booleans. `pending` = created but not
     *  yet activated/verified; `deleted` = soft-deleted; `forgotten` = GDPR tombstone (redacted, retained). */
    export enum ContactStatus { PENDING = "pending", ACTIVE = "active", ARCHIVED = "archived", DELETED = "deleted", FORGOTTEN = "forgotten" }

    // ──────────────────────────────────────────────────────────────────────────
    // Value objects
    // ──────────────────────────────────────────────────────────────────────────

    /** Common to the multi-valued contact attributes — exactly one per list is the default. */
    export interface ContactEntry { isDefault: boolean; verified?: boolean; }

    /** One of many emails. */
    export interface EmailEntry extends ContactEntry { value: Type.Email; context: EmailContext; }

    /** One of many phones, E.164. */
    export interface PhoneEntry extends ContactEntry { value: Type.PhoneE164; type: PhoneType; }

    /** One of many addresses. */
    export interface AddressEntry extends ContactEntry
    {
        type:        AddressType;
        line1?:      string;
        line2?:      string;
        city?:       string;
        county?:     string;   // county / district — a segmentation dimension (see Segment.FieldId.COUNTY)
        region?:     string;   // state / province
        postalCode?: string;
        country?:    string;   // ISO 3166-1 alpha-2
        timeZone?:   Type.TimeZone;   // tz for this address — drives quiet-hours
        latitude?:   number;   // geocoded lat for THIS address (feeds the geo/distance segment filter)
        longitude?:  number;   // geocoded lng for THIS address
    }

    export interface SocialHandle { platform: string; handle: string; url?: Type.Url; }

    /**
     * Per-channel consent event — `proof` retained for TCPA. The effective state per channel is the record
     * with the latest `at`, so an `opted_in` dated after an `opted_out` re-enables sending (except a
     * complaint / hard-bounce suppression, which is a separate hard block).
     */
    export interface ConsentRecord { channel: Channel; state: ConsentState; source?: string; at: Type.ISODateTime; proof?: string; }

    /** Per-channel suppression — how a contact came to be suppressed. */
    export interface SuppressionRecord { channel: Channel; suppressed: boolean; origin: SuppressionOrigin; source?: string; reason?: string; at: Type.ISODateTime; }

    /** A tag in one of the three namespaces; campaign tags carry provenance. */
    export interface Tag { namespace: TagNamespace; value: string; campaignId?: Type.UUID; }

    /**
     * One external-system linkage for sync/dedup. The value is an OBJECT (not a bare string) on purpose: an
     * external id can be compound (a tenant + record id, a composite key) and we want room for sync metadata
     * (`lastSyncAt`) without another schema change. `id` is the record's identifier in that system.
     */
    export interface ExternalRef { id: string; lastSyncAt?: Type.ISODateTime; }

    /**
     * A contact's links to 0..N external systems, keyed by the system id (e.g. `l2`, `mscrm`, `shopify`). Use
     * `system:<context>` to disambiguate multiple instances of the same system (two Salesforce orgs). Every
     * value is an `ExternalRef` object — safe for compound ids + future sync fields.
     */
    export interface ExternalRefs { [ system: string ]: ExternalRef; }

    /** Who/when. */
    export interface AuditMeta { createdAt: Type.ISODateTime; createdBy: Type.UUID; modifiedAt: Type.ISODateTime; modifiedBy: Type.UUID; }

    // ──────────────────────────────────────────────────────────────────────────
    // Custom fields — account-defined extra fields on a contact. The DEFINITION (uid/type/label/choices) is
    // account-level (managed under Settings → Contacts); each contact stores only the VALUE keyed by field uid.
    //   DynamoDB: field_defs  PK: accountId  SK: fieldUid
    // ──────────────────────────────────────────────────────────────────────────

    /** Custom-field type — IMMUTABLE once the field is created (changing a live field's type would orphan values). */
    export enum CustomFieldType
    {
        TEXT         = "text",           // single-line string
        MULTILINE    = "multiline",      // multi-line string
        NUMBER       = "number",
        CURRENCY     = "currency",       // minor units; the field def fixes the currency code
        DATE         = "date",           // ISO date (no time)
        DATETIME     = "datetime",       // ISO date-time
        CHOICE       = "choice",         // dropdown, single select
        MULTI_CHOICE = "multi_choice",   // dropdown, multi select (tag-like)
        URL          = "url",
        PHONE        = "phone",          // E.164
        EMAIL        = "email",
        BOOLEAN      = "boolean",        // yes / no
    }

    /** Custom-field lifecycle. `archived` = hidden but kept (values retained). `deleted` = soft-deleted +
     *  recoverable by an app admin; a cron purges DELETED fields after a TTL. */
    export enum CustomFieldStatus { ACTIVE = "active", ARCHIVED = "archived", DELETED = "deleted" }

    /** A dropdown option — the value stores the stable `key`; `label` is display-only. Choices are ADD-ONLY. */
    export interface ChoiceOption { key: string; label: string; }

    /**
     * A custom-field value is ALWAYS stored as a **string** on the contact — the def's `type` tells the
     * renderer how to parse/format it (number/currency → numeric string, date/datetime → ISO string, boolean →
     * "true"/"false", CHOICE → the option key, MULTI_CHOICE → the keys joined by "," ). Storage stays simple +
     * uniform (uid → string); conversion lives at the edges (render in / validate + serialize out).
     */
    export type CustomFieldValue = string;
    /** A contact's custom-field values, keyed by field uid (value always a string — see CustomFieldValue). */
    export interface CustomFieldValues { [fieldUid: string]: CustomFieldValue; }

    /**
     * The account-level DEFINITION of a custom field. Managed under Settings → Contacts. Fields are ordered +
     * grouped for the contact profile: `group` is a label/context ("Work", "Preferences") and `order` sorts
     * within it. `currency` applies only to CURRENCY fields (per-field, e.g. "USD"). `indexed` surfaces the
     * field to search so it's usable as a segment filter condition.
     */
    export interface CustomFieldDef
    {
        uid:           Type.UUID;          // the field id (referenced by contact values)
        accountId:     Type.UUID;
        label:         string;
        type:          CustomFieldType;    // immutable after creation
        choices?:      Array<ChoiceOption>; // CHOICE / MULTI_CHOICE — add-only
        currency?:     string;             // CURRENCY only — the fixed ISO currency code (per-field)
        required?:     boolean;
        indexed?:      boolean;            // surfaced to search → usable in segment filters
        group?:        string;             // grouping label/context in the profile
        order?:        number;             // sort order within its group
        status:        CustomFieldStatus;  // active | archived (never removed)
        audit:         AuditMeta;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Contact (the resource)
    //   DynamoDB: contacts  PK: accountId  SK: contactId
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:          Type.UUID;          // the contact id
        accountId:   Type.UUID;
        ref?:        number;             // per-account sequential reference number (server-assigned on create, immutable, never reused)

        firstName?:  string;
        lastName?:   string;
        emails:      Array<EmailEntry>;
        phones:      Array<PhoneEntry>;
        addresses?:  Array<AddressEntry>;
        tz?:         Type.TimeZone;      // drives quiet-hours sending
        latitude?:   number;             // contact-level geo (derived / provided)
        longitude?:  number;

        // demographics (voter-file / CRM data)
        estimatedBirthdate?: Type.ISODateTime;   // best-estimate DOB (may be year-only precision)
        sex?:                Sex;
        politicalParty?:     PoliticalParty;

        preferredLanguage?: Locale;      // the contact's preferred language (BCP-47) — drives language-variant selection
        primaryLanguage?:   Locale;      // primary/secondary select a campaign's language variant
        secondaryLanguage?: Locale;

        link?:       Type.Url;
        social?:     Array<SocialHandle>;
        externalRefs?: ExternalRefs;     // 0..N external-system linkages (L2, mscrm, …) for sync/dedup
        notes?:      string;             // free-text — treat as PII

        tags?:         Array<Tag>;
        customFields?: CustomFieldValues;       // account-defined field values, keyed by field uid
        consent?:      Array<ConsentRecord>;
        suppression?:  Array<SuppressionRecord>;
        segmentIds?:   Array<Type.UUID>;        // contact ↔ segment join

        status:      ContactStatus;      // active | archived | forgotten
        audit:       AuditMeta;
    }

    /** Create payload — server assigns id / accountId / ref / status / audit. */
    export type CreateContact = Omit<Entity, "id" | "accountId" | "ref" | "status" | "audit">;

    /** Update payload — any subset of the createable fields. */
    export type UpdateContact = Partial<CreateContact>;

    /** PUT consent — replace per-channel consent + suppression. */
    export interface ConsentUpdate { consent?: Array<ConsentRecord>; suppression?: Array<SuppressionRecord>; }

    // Segmentation (the segment query language, the saved Segment, and the contact↔segment membership join)
    // now lives in its own contract — see `Segment` in ./Segment. `Contact.segmentIds` stays here as the
    // per-contact display cache of that join.

    /**
     * Read-time DEFAULTs for a partial `contacts` row. Apply with `ObjectUtils.withDefaults( row,
     * Contact.DEFAULT )`. Identity / audit fields (`id`, `accountId`, `audit`) are OMITTED — a row missing
     * those is an anomaly to surface, not fabricate.
     */
    export const DEFAULT : Partial<Entity> =
    {
        emails: [],
        phones: [],
        tags:   [],
        status: ContactStatus.ACTIVE,
    };

    // ── Schema + validator for the API record `Entity` ───────────────────────────────────────────
    const EMAIL_ENTRY_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "value", "context", "isDefault" ],
        properties: { value: { type: "string" }, context: { type: "string", enum: Object.values( EmailContext ) }, isDefault: { type: "boolean" }, verified: { type: "boolean" } },
    };
    const PHONE_ENTRY_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "value", "type", "isDefault" ],
        properties: { value: { type: "string" }, type: { type: "string", enum: Object.values( PhoneType ) }, isDefault: { type: "boolean" }, verified: { type: "boolean" } },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: true,
        required: [ "id", "accountId", "emails", "phones", "status", "audit" ],
        properties:
        {
            id:                { type: "string", format: "uuid" },
            accountId:         { type: "string", format: "uuid" },
            ref:               { type: "number" },   // per-account sequential reference number (optional: older rows may predate it)
            firstName:         { type: "string" },
            lastName:          { type: "string" },
            emails:            { type: "array", items: EMAIL_ENTRY_SCHEMA },
            phones:            { type: "array", items: PHONE_ENTRY_SCHEMA },
            tz:                { type: "string" },
            latitude:          { type: "number" },
            longitude:         { type: "number" },
            estimatedBirthdate: { type: "string" },
            sex:               { type: "string", enum: Object.values( Sex ) },
            politicalParty:    { type: "string", enum: Object.values( PoliticalParty ) },
            preferredLanguage: { type: "string" },
            primaryLanguage:   { type: "string" },
            secondaryLanguage: { type: "string" },
            link:              { type: "string" },
            externalRefs:      { type: "object" },   // { system: { id, lastSyncAt? } }
            notes:             { type: "string" },
            status:            { type: "string", enum: Object.values( ContactStatus ) },
            segmentIds:        { type: "array", items: { type: "string" } },
            audit:             { type: "object" },
        },
    };

    /** Validate a `Contact.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Contact;
// eof
