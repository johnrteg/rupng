//
import { Type } from "@repo/common";
import { Contact } from "./Contact";
import { Validation } from "../../model/Validation";

//
// ImportMap — the shared **wire contract** for a reusable **column→field mapping** used to import a tabular
// file (CSV today; TSV / XLSX / vCard / JSON anticipated) into an application entity. It's what turns "an
// arbitrary CSV someone exported" into contacts without re-mapping every time: a saved set of per-column
// mappings + ETL transforms (trim, split-name, phone→E.164, date parse, lookup, …), a target (where the rows
// land), and file parse options.
//
// Two scopes (see apps/core/contact/SPECS.md → "Data maps"):
//   • SYSTEM — platform-provided catalog maps for common sources/CRMs (L2 voter file, Mailchimp, HubSpot,
//     Salesforce, generic vCard). Read-only to accounts; an account can only **copy** one into its own space.
//   • ACCOUNT — the account's own maps for its recurring file shapes: create / edit / copy / archive / delete.
//
// Lives in the contact domain because that's the most common import target — but `target` lets a map declare
// a different destination, so the model isn't contact-only. Reuses `Contact.AuditMeta` (who/when) rather than
// re-declaring it.
//
//   Storage: DynamoDB `import_maps`  PK: accountId  SK: mapId. SYSTEM maps live under a reserved `system`
//   partition (`accountId = "system"`) so every account can read them in one Query alongside its own.
//
export namespace ImportMap
{
    /** Reserved partition key under which platform-provided (SYSTEM-scope) maps are stored + read by every account. */
    export const SYSTEM_ACCOUNT : string = "system";

    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    /** Who owns the map. SYSTEM maps are platform-provided (read-only to accounts, copyable); ACCOUNT maps are the account's own (editable). */
    export enum Scope { SYSTEM = "system", ACCOUNT = "account" }

    /** Map lifecycle. `archived` = hidden but kept (past import jobs may reference it); `deleted` = soft-deleted +
     *  recoverable by an admin; a cron purges DELETED maps after a TTL. Mirrors the custom-field / segment pattern. */
    export enum Status { ACTIVE = "active", ARCHIVED = "archived", DELETED = "deleted" }

    /** Where the imported rows land. CONTACT is the common one; the set is closed + extensible as other importers land. */
    export enum Target { CONTACT = "contact" }

    /** The source file's format — drives which parser runs. */
    export enum SourceFormat { CSV = "csv", TSV = "tsv", XLSX = "xlsx", VCARD = "vcard", JSON = "json" }

    /**
     * ETL adaptor applied to a source column (or several) before the value lands in the internal field. Most
     * transforms take a single source column; `SPLIT_NAME` / `SPLIT` fan one column out to many (see
     * `TransformOptions.targetFields`), and `JOIN` combines several columns (see `TransformOptions.sources`).
     */
    export enum Transform
    {
        NONE            = "none",             // copy the value through unchanged
        TRIM            = "trim",             // strip surrounding whitespace
        LOWERCASE       = "lowercase",
        UPPERCASE       = "uppercase",
        TITLE_CASE      = "title_case",       // "john smith" → "John Smith"
        SPLIT_NAME      = "split_name",       // "John Q Smith" → firstName / lastName (→ targetFields)
        JOIN            = "join",             // combine multiple source columns with a delimiter (← sources)
        SPLIT           = "split",            // split one column into many by a delimiter (→ targetFields)
        PHONE_E164      = "phone_e164",       // normalize a phone to E.164 (uses defaultCountry)
        EMAIL_NORMALIZE = "email_normalize",  // trim + lowercase an email
        DATE            = "date",             // parse a date with `format` → ISO date (no time)
        DATETIME        = "datetime",         // parse a date-time with `format` (+ `timeZone`) → ISO date-time
        BOOLEAN         = "boolean",          // "yes"/"1"/"true"/"y" → boolean (see trueValues)
        NUMBER          = "number",           // parse a numeric string
        COUNTRY_CODE    = "country_code",     // country name/alpha-3 → ISO 3166-1 alpha-2
        CONSTANT        = "constant",         // ignore the source; set a fixed value (see constant)
        LOOKUP          = "lookup",           // map a source value → internal value via a table (see lookup)
        DEFAULT_IF_EMPTY = "default_if_empty", // pass through, but substitute `constant` when the source is empty
    }

    /** What to do when a transform / required-field check fails on a row. */
    export enum OnError { FAIL = "fail", SKIP_ROW = "skip_row", SET_NULL = "set_null", USE_DEFAULT = "use_default" }

    /** Dedup behaviour on import — how an incoming row reconciles with an existing contact. */
    export enum DedupeMode { CREATE = "create", SKIP = "skip", UPDATE = "update", MERGE = "merge" }

    /** Which key(s) match an incoming row to an existing record for dedup/upsert. */
    export enum MatchKey { EMAIL = "email", PHONE = "phone", EXTERNAL_REF = "external_ref", CUSTOM = "custom" }

    // ──────────────────────────────────────────────────────────────────────────
    // Value objects
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Adaptor-specific configuration for a `FieldMapping.transform`. All optional — only the fields the chosen
     * transform reads apply (e.g. `format` for DATE/DATETIME, `delimiter` + `targetFields` for SPLIT, `sources`
     * for JOIN, `constant` for CONSTANT/DEFAULT_IF_EMPTY, `lookup` for LOOKUP).
     */
    export interface TransformOptions
    {
        format?:         string;               // date/datetime parse format, e.g. "MM/DD/YYYY" or "YYYY-MM-DD HH:mm"
        delimiter?:      string;               // SPLIT/JOIN delimiter (default " " for names, "," otherwise)
        sources?:        Array<string>;        // JOIN: the source columns to combine (in order)
        targetFields?:   Array<string>;        // SPLIT / SPLIT_NAME: the internal fields the parts map to (in order)
        constant?:       string;               // CONSTANT / DEFAULT_IF_EMPTY value
        lookup?:         Record<string, string>; // LOOKUP table (source value → internal value)
        trueValues?:     Array<string>;        // BOOLEAN: tokens treated as true ("yes","y","1","true")
        defaultCountry?: string;               // PHONE_E164 / COUNTRY_CODE: ISO 3166-1 alpha-2 fallback region
        locale?:         string;               // DATE/DATETIME/NUMBER locale hint
        timeZone?:       Type.TimeZone;         // DATETIME: zone the source time is expressed in
        onError?:        OnError;              // per-mapping error handling (overrides the map-level default)
    }

    /**
     * One column mapping: a source column → an internal field, with an optional transform. `internalField` is a
     * model field path on the target entity — e.g. `firstName`, `emails[].value`, `phones[].value`, or a custom
     * field's uid. `externalField` is the source column header (or, for headerless files, its index as a string).
     */
    export interface FieldMapping
    {
        externalField: string;                 // source column header (or column index for headerless files)
        internalField: string;                 // target field path on the entity (or a custom-field uid)
        transform?:    Transform;              // ETL adaptor (default NONE — copy through)
        options?:      TransformOptions;       // adaptor config (format, delimiter, lookup, constant, …)
        required?:     boolean;                // fail/skip the row (per onError) when the source value is empty
        isKey?:        boolean;                // participates in dedup/upsert matching
        notes?:        string;                 // authoring note (why this mapping / edge cases)
    }

    /** File-level parse options — how to read the raw source before mapping. */
    export interface ParseOptions
    {
        format:      SourceFormat;
        delimiter?:  string;                   // field delimiter (default "," for CSV, "\t" for TSV)
        quote?:      string;                   // quote char (default '"')
        hasHeader?:  boolean;                  // first row is a header (default true)
        skipRows?:   number;                   // preamble rows to skip before the header
        encoding?:   string;                   // e.g. "utf-8", "latin1"
        sheet?:      string;                   // XLSX: sheet name/index to read
    }

    /** Dedup/upsert strategy applied while writing the imported rows. */
    export interface Dedupe
    {
        mode:      DedupeMode;                 // create | skip | update | merge on a match
        matchKeys: Array<MatchKey>;            // which key(s) identify an existing record
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ImportMap (the resource)
    //   DynamoDB: import_maps  PK: accountId ("system" for platform maps)  SK: mapId
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:            Type.UUID;              // the map id
        accountId:     Type.UUID;              // owning account ("system" for platform-provided maps)
        scope:         Scope;                  // system (read-only) | account (editable)
        name:          string;
        description?:  string;

        target:        Target;                 // where the rows land (contact, …)
        sourceFormat:  SourceFormat;           // the file format this map expects
        parse?:        ParseOptions;           // file-level parse options (delimiter/header/encoding/…)
        mappings:      Array<FieldMapping>;    // the column→field mappings + transforms

        dedupe?:       Dedupe;                 // upsert strategy on import (create/skip/update/merge + match keys)
        defaultTags?:  Array<string>;          // tags applied to every row imported with this map (provenance)
        sampleHeaders?: Array<string>;         // headers remembered from a sample file — powers the editor's pickers

        sourceMapId?:  Type.UUID;              // if copied, the map this was cloned from (system or account origin)
        version?:      number;                 // bumped on each edit; recorded on the ImportJob for repeatability

        status:        Status;                 // active | archived | deleted (soft-delete, recoverable, cron-purged)
        audit:         Contact.AuditMeta;
    }

    /** Create payload — server assigns id / accountId / scope / status / audit. */
    export type Create = Omit<Entity, "id" | "accountId" | "scope" | "status" | "audit">;

    /** Update payload — any subset of the createable fields. */
    export type Update = Partial<Create>;

    /** Copy payload — clone an existing (system or account) map into the account's space, optionally renamed. */
    export interface Copy { sourceMapId: Type.UUID; name?: string; }

    /**
     * Read-time DEFAULTs for a partial `import_maps` row / a new-map form. Apply with
     * `ObjectUtils.withDefaults( row, ImportMap.DEFAULT )`. Identity / audit fields (`id`, `accountId`, `audit`)
     * are OMITTED — a row missing those is an anomaly to surface, not fabricate.
     */
    export const DEFAULT : Partial<Entity> =
    {
        scope:        Scope.ACCOUNT,
        target:       Target.CONTACT,
        sourceFormat: SourceFormat.CSV,
        parse:        { format: SourceFormat.CSV, delimiter: ",", hasHeader: true },
        mappings:     [],
        version:      1,
        status:       Status.ACTIVE,
    };

    // ── Schema + validator for the API record `Entity` ───────────────────────────────────────────
    const FIELD_MAPPING_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: true, required: [ "externalField", "internalField" ],
        properties:
        {
            externalField: { type: "string" },
            internalField: { type: "string" },
            transform:     { type: "string", enum: Object.values( Transform ) },
            options:       { type: "object" },
            required:      { type: "boolean" },
            isKey:         { type: "boolean" },
            notes:         { type: "string" },
        },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: true,
        required: [ "id", "accountId", "scope", "name", "target", "sourceFormat", "mappings", "status", "audit" ],
        properties:
        {
            id:            { type: "string", format: "uuid" },
            accountId:     { type: "string" },
            scope:         { type: "string", enum: Object.values( Scope ) },
            name:          { type: "string" },
            description:   { type: "string" },
            target:        { type: "string", enum: Object.values( Target ) },
            sourceFormat:  { type: "string", enum: Object.values( SourceFormat ) },
            parse:         { type: "object" },
            mappings:      { type: "array", items: FIELD_MAPPING_SCHEMA },
            dedupe:        { type: "object" },
            defaultTags:   { type: "array", items: { type: "string" } },
            sampleHeaders: { type: "array", items: { type: "string" } },
            sourceMapId:   { type: "string", format: "uuid" },
            version:       { type: "number" },
            status:        { type: "string", enum: Object.values( Status ) },
            audit:         { type: "object" },
        },
    };

    /** Validate an `ImportMap.Entity` (a wire payload, a stored row). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default ImportMap;
// eof
