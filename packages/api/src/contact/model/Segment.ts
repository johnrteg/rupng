//
import { Type } from "@repo/common";
import { Contact } from "./Contact";

//
// Segment — the shared **wire contract** for segmentation (the primary targeting tool in the contact domain).
// Split out of `Contact` so the segment query language, the saved segment, and the contact↔segment membership
// join each have a single canonical home. Segments reuse a couple of contact primitives (`Contact.Channel`
// for per-channel reach, `Contact.AuditMeta` for who/when) — imported here, never re-declared.
//
// Storage (see apps/core/contact/SPECS.md): DynamoDB is the SoT — segments PK: accountId SK: segmentId;
// segment_members PK: segmentKey (`accountId#segmentId`) SK: contactId (GSI byContact for the reverse lookup).
//
export namespace Segment
{
    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Segment lifecycle. Materialization from a filter is a job, so a segment moves
     * `pending → processing → active` (active = materialized/complete/ready), or `failed` if the job errored.
     * `inactive` = user-disabled; `archived`/`deleted` hide it from pickers (membership + counts retained).
     */
    export enum Status
    {
        PENDING    = "pending",       // queued for (re)materialization from its filter
        PROCESSING = "processing",    // the materialization job is running
        ACTIVE     = "active",        // materialized / ready (complete)
        FAILED     = "failed",        // materialization failed (retryable)
        INACTIVE   = "inactive",      // user-disabled
        ARCHIVED   = "archived",      // hidden but retained
        DELETED    = "deleted",       // soft-deleted, recoverable, cron-purged
    }

    /**
     * How a contact came to be in (or be held out of) a segment.
     *   `query`    — matched the filter (reconciled every materialize).
     *   `manual`   — a user **pinned it IN** (kept across refreshes).
     *   `import`   — added by a CSV import.
     *   `excluded` — a user **pinned it OUT** (a tombstone; never re-added by the query). Not counted as a member.
     */
    export enum MembershipSource { MANUAL = "manual", QUERY = "query", IMPORT = "import", EXCLUDED = "excluded" }

    /** What triggered a materialization run (for the history log). */
    export enum RunTrigger { INITIAL = "initial", EDIT = "edit", REFRESH = "refresh" }

    /** Outcome of a materialization run. */
    export enum RunStatus { COMPLETE = "complete", FAILED = "failed" }

    /**
     * Group boolean operator — how the rules in a group combine. Matches the builder UI vocabulary:
     * `all` = AND (every rule must match), `any` = OR (at least one), `none` = NOT (no rule may match).
     */
    export enum GroupOp { ALL = "all", ANY = "any", NONE = "none" }

    /**
     * Filter operator — the comparison a condition applies. A field's *allowed* operators derive from its
     * `FilterType` via `DEFAULT_OPERATORS`, but any field may override that list (see `FilterField.operators`) —
     * the type→operator grouping is a sensible DEFAULT, not a hard rule, because there are field-level exceptions.
     */
    export enum Operator
    {
        IS                    = "is",             // equals
        IS_NOT                = "is_not",         // not equals
        CONTAINS              = "contains",       // substring / membership
        BEGINS_WITH           = "begins_with",
        ENDS_WITH             = "ends_with",      // e.g. email domain match
        LESS_THAN             = "lt",
        LESS_THAN_OR_EQUAL    = "lte",
        GREATER_THAN          = "gt",
        GREATER_THAN_OR_EQUAL = "gte",
        BETWEEN               = "between",        // inclusive range → operand is [from, to]
        ANY_OF                = "any_of",         // set intersects (at least one of)
        EVERY_OF              = "every_of",       // set superset (all of)
        NONE_OF               = "none_of",        // set disjoint (none of)
        WITHIN                = "within",         // geo distance → operand is { lat, lng, radius, unit }
        IS_EMPTY              = "is_empty",       // unset / no value — no operand
        IS_NOT_EMPTY          = "is_not_empty",   // has any value — no operand
    }

    /**
     * The DATA TYPE of a filterable field — drives the DEFAULT operator set (see `DEFAULT_OPERATORS`) and the
     * operand editor the builder renders. This set GROWS as new field kinds land; a field can always override
     * its operators for an exception.
     */
    export enum FilterType
    {
        STRING      = "string",       // free text (street, city, names, zip)
        NUMBER      = "number",
        DATE        = "date",         // ISO date, no time
        DATETIME    = "datetime",     // ISO date-time
        BOOLEAN     = "boolean",
        ENUM        = "enum",         // closed picklist (state, country, timezone, phone country code)
        PHONE       = "phone",        // phone number (string-like, but its own type)
        TAGS        = "tags",         // multi-value set on the contact
        SEGMENT_REF = "segment_ref",  // belongs-to-segment membership
        REF_SET     = "ref_set",      // external map / import-source refs ("imported from")
        GEO         = "geo",          // lat/long + distance
    }

    /** Operand cardinality an operator expects — lets the builder + validator pick the right editor/shape. */
    export enum Operand { NONE = "none", SINGLE = "single", PAIR = "pair", SET = "set", GEO = "geo" }

    /**
     * A specialized operand editor a field wants (beyond the generic text/select/multi). Lets the builder swap
     * in the domain widget — a country multi-select, a state chips input, a timezone multi-select — instead of a
     * plain list. Optional: a field with no `input` uses the generic editor for its type/operator.
     */
    export enum InputKind { COUNTRY = "country", STATE = "state", TIMEZONE = "timezone" }

    /** Distance unit for a `WITHIN` geo operand. */
    export enum DistanceUnit { MILES = "mi", KILOMETERS = "km" }

    /** Sort direction for the segment's result ordering. */
    export enum SortDir { ASC = "asc", DESC = "desc" }

    /** How the segment's matched contacts are ordered (for preview + the materialized snapshot). `field` is a `FieldId`. */
    export interface Sort { field: string; direction: SortDir; }

    // ──────────────────────────────────────────────────────────────────────────
    // Query language — a hierarchical boolean tree of conditions + groups
    // ──────────────────────────────────────────────────────────────────────────

    /** A `WITHIN` operand — a circle: everything within `radius` (`unit`) of the point. */
    export interface GeoWithin { lat: number; lng: number; radius: number; unit: DistanceUnit; }

    /**
     * One filter condition: a field + an operator + its operand. The operand shape depends on the operator
     * (see `OPERATOR_OPERAND`): SINGLE ops read `value`; BETWEEN reads `values` as `[from, to]`; the set ops
     * (`ANY_OF`/`EVERY_OF`/`NONE_OF`) read `values`; `WITHIN` reads `value` as a `GeoWithin`; the empty ops
     * (`IS_EMPTY`/`IS_NOT_EMPTY`) take no operand. `field` is a `FieldId` for a built-in field or a custom
     * field's uid.
     */
    export interface Condition { field: string; operator: Operator; value?: Type.Json; values?: Array<Type.Json>; }

    /** A group of rules combined by `op`. Groups nest (a rule may itself be a group) → arbitrary hierarchy. */
    export interface Group { op: GroupOp; conditions: Array<Condition | Group>; }

    /** Root group of the saved query. */
    export type Query = Group;

    // ──────────────────────────────────────────────────────────────────────────
    // Field catalog — the filterable fields + their type/operators (the "what you can filter on" contract)
    // ──────────────────────────────────────────────────────────────────────────

    /** Built-in filterable field ids. Custom fields are referenced by their uid (not listed here). GROWS over time. */
    export enum FieldId
    {
        SEGMENT               = "segment",                 // belongs-to-segment (one or more segments)
        CAMPAIGN              = "campaign",                 // in a campaign's audience — resolves via the segment the campaign owns
        IMPORTED_FROM         = "importedFrom",            // external map / import-source refs
        TAGS                  = "tags",
        FIRST_NAME            = "firstName",
        LAST_NAME             = "lastName",
        EMAIL                 = "email",
        PHONE_NUMBER          = "phoneNumber",
        STREET                = "street",
        CITY                  = "city",
        COUNTY                = "county",
        STATE                 = "state",
        ZIP                   = "zip",
        COUNTRY               = "country",
        AREA_CODE             = "areaCode",
        PHONE_COUNTRY_CODE    = "phoneCountryCode",
        TIMEZONE              = "timezone",
        TIMEZONE_OF_AREA_CODE = "timezoneOfAreaCode",
        GEO_DISTANCE          = "geoDistance",             // lat/long + distance
        CREATED_DATE          = "createdDate",
        MODIFIED_DATE         = "modifiedDate",
        LAST_SYNC_AT          = "lastSyncAt",              // sync / ext-ref last sync date-time
    }

    /**
     * Describes one filterable field for the builder. `operators` is the EXCEPTION hook: when set it REPLACES
     * the type's default operator list (see `operatorsFor`); when omitted the field uses `DEFAULT_OPERATORS[type]`.
     * `group` is a UI section label; `enumValues` (or a runtime source) backs an ENUM field's picker.
     */
    export interface FilterField
    {
        id:          string;             // FieldId for a built-in, or a custom-field uid
        label:       string;
        type:        FilterType;
        group?:      string;             // UI grouping ("Identity", "Location", "Phone", "Dates", "Membership", "Sync")
        operators?:  Array<Operator>;    // OVERRIDE the type defaults (field-level exception); omit → defaults
        enumValues?: Array<string>;      // ENUM: closed choices (else resolved from a runtime source by `id`)
        input?:      InputKind;          // a specialized operand editor (country / state / timezone multi-select)
        isCustom?:   boolean;            // true for account custom fields (merged in at runtime)
    }

    /** The set operators (+ empty) — the operator set for the geo/locale pick-list fields (country/state/tz). */
    const SET_OPERATORS : Array<Operator> = [ Operator.ANY_OF, Operator.NONE_OF, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ];

    // ──────────────────────────────────────────────────────────────────────────
    // Type → default operators. A field inherits these unless it overrides `operators`. The exceptions are
    // real: e.g. `state`/`country` are ENUM (pick from a list), `email` adds ENDS_WITH for domain matching.
    // ──────────────────────────────────────────────────────────────────────────
    export const DEFAULT_OPERATORS : Record<FilterType, Array<Operator>> =
    {
        [ FilterType.STRING ]:      [ Operator.IS, Operator.IS_NOT, Operator.CONTAINS, Operator.BEGINS_WITH, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.NUMBER ]:      [ Operator.IS, Operator.IS_NOT, Operator.LESS_THAN, Operator.LESS_THAN_OR_EQUAL, Operator.GREATER_THAN, Operator.GREATER_THAN_OR_EQUAL, Operator.BETWEEN, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.DATE ]:        [ Operator.IS, Operator.IS_NOT, Operator.LESS_THAN, Operator.LESS_THAN_OR_EQUAL, Operator.GREATER_THAN, Operator.GREATER_THAN_OR_EQUAL, Operator.BETWEEN, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.DATETIME ]:    [ Operator.IS, Operator.IS_NOT, Operator.LESS_THAN, Operator.LESS_THAN_OR_EQUAL, Operator.GREATER_THAN, Operator.GREATER_THAN_OR_EQUAL, Operator.BETWEEN, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.BOOLEAN ]:     [ Operator.IS, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.ENUM ]:        [ Operator.IS, Operator.IS_NOT, Operator.ANY_OF, Operator.NONE_OF, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.PHONE ]:       [ Operator.IS, Operator.IS_NOT, Operator.CONTAINS, Operator.BEGINS_WITH, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.TAGS ]:        [ Operator.ANY_OF, Operator.EVERY_OF, Operator.NONE_OF, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.SEGMENT_REF ]: [ Operator.ANY_OF, Operator.EVERY_OF, Operator.NONE_OF, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.REF_SET ]:     [ Operator.ANY_OF, Operator.NONE_OF, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
        [ FilterType.GEO ]:         [ Operator.WITHIN, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ],
    };

    /** Operand cardinality per operator — the builder uses this to render the right operand editor. */
    export const OPERATOR_OPERAND : Record<Operator, Operand> =
    {
        [ Operator.IS ]:                    Operand.SINGLE,
        [ Operator.IS_NOT ]:                Operand.SINGLE,
        [ Operator.CONTAINS ]:              Operand.SINGLE,
        [ Operator.BEGINS_WITH ]:           Operand.SINGLE,
        [ Operator.ENDS_WITH ]:             Operand.SINGLE,
        [ Operator.LESS_THAN ]:             Operand.SINGLE,
        [ Operator.LESS_THAN_OR_EQUAL ]:    Operand.SINGLE,
        [ Operator.GREATER_THAN ]:          Operand.SINGLE,
        [ Operator.GREATER_THAN_OR_EQUAL ]: Operand.SINGLE,
        [ Operator.BETWEEN ]:               Operand.PAIR,
        [ Operator.ANY_OF ]:                Operand.SET,
        [ Operator.EVERY_OF ]:              Operand.SET,
        [ Operator.NONE_OF ]:               Operand.SET,
        [ Operator.WITHIN ]:                Operand.GEO,
        [ Operator.IS_EMPTY ]:              Operand.NONE,
        [ Operator.IS_NOT_EMPTY ]:          Operand.NONE,
    };

    /** The built-in filterable fields (the first set). Custom fields are appended at runtime — see `customField`. */
    export const FIELDS : Array<FilterField> =
    [
        { id: FieldId.SEGMENT,               label: "Belongs to segment",     type: FilterType.SEGMENT_REF, group: "Membership" },
        // "in a campaign's audience" — indirection: the operand is campaign id(s); evaluation resolves each to
        // the segment the campaign owns (Segment.campaignId) and tests membership of that segment.
        { id: FieldId.CAMPAIGN,              label: "In campaign audience",   type: FilterType.SEGMENT_REF, group: "Membership" },
        { id: FieldId.IMPORTED_FROM,         label: "Imported from",          type: FilterType.REF_SET,     group: "Membership" },
        { id: FieldId.TAGS,                  label: "Tags",                   type: FilterType.TAGS,        group: "Membership" },
        { id: FieldId.FIRST_NAME,            label: "First name",             type: FilterType.STRING,      group: "Identity" },
        { id: FieldId.LAST_NAME,             label: "Last name",              type: FilterType.STRING,      group: "Identity" },
        // email overrides the STRING defaults to add ENDS_WITH (domain matching, e.g. ends-with "@gmail.com")
        { id: FieldId.EMAIL,                 label: "Email",                  type: FilterType.STRING,      group: "Identity",
          operators: [ Operator.IS, Operator.IS_NOT, Operator.CONTAINS, Operator.BEGINS_WITH, Operator.ENDS_WITH, Operator.IS_EMPTY, Operator.IS_NOT_EMPTY ] },
        { id: FieldId.PHONE_NUMBER,          label: "Phone number",           type: FilterType.PHONE,       group: "Phone" },
        { id: FieldId.STREET,                label: "Street",                 type: FilterType.STRING,      group: "Location" },
        { id: FieldId.CITY,                  label: "City",                   type: FilterType.STRING,      group: "Location" },
        { id: FieldId.COUNTY,                label: "County",                 type: FilterType.STRING,      group: "Location" },
        { id: FieldId.STATE,                 label: "State",                  type: FilterType.ENUM,        group: "Location", operators: SET_OPERATORS, input: InputKind.STATE },
        { id: FieldId.ZIP,                   label: "Zip",                    type: FilterType.STRING,      group: "Location" },
        { id: FieldId.COUNTRY,               label: "Country",                type: FilterType.ENUM,        group: "Location", operators: SET_OPERATORS, input: InputKind.COUNTRY },
        { id: FieldId.AREA_CODE,             label: "Area code",              type: FilterType.STRING,      group: "Phone" },
        { id: FieldId.PHONE_COUNTRY_CODE,    label: "Phone country code",     type: FilterType.ENUM,        group: "Phone" },
        { id: FieldId.TIMEZONE,              label: "Timezone",               type: FilterType.ENUM,        group: "Location", operators: SET_OPERATORS, input: InputKind.TIMEZONE },
        { id: FieldId.TIMEZONE_OF_AREA_CODE, label: "Timezone of area code",  type: FilterType.ENUM,        group: "Phone",    operators: SET_OPERATORS, input: InputKind.TIMEZONE },
        { id: FieldId.GEO_DISTANCE,          label: "Location within",        type: FilterType.GEO,         group: "Location" },
        { id: FieldId.CREATED_DATE,          label: "Created date",           type: FilterType.DATETIME,    group: "Dates" },
        { id: FieldId.MODIFIED_DATE,         label: "Modified date",          type: FilterType.DATETIME,    group: "Dates" },
        { id: FieldId.LAST_SYNC_AT,          label: "Last sync date/time",    type: FilterType.DATETIME,    group: "Sync" },
    ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // The operators a field allows: its override list when present, else the type's defaults.
    export function operatorsFor( field : FilterField ) : Array<Operator>
    {
        return field.operators ?? DEFAULT_OPERATORS[ field.type ] ?? [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Map a custom-field def's type to a filter data type, so account custom fields join the catalog at runtime.
    export function customFieldFilterType( type : Contact.CustomFieldType ) : FilterType
    {
        // group the custom-field types onto the filter data types (the exception hook still applies per field)
        switch( type )
        {
            case Contact.CustomFieldType.NUMBER:
            case Contact.CustomFieldType.CURRENCY:      return FilterType.NUMBER;
            case Contact.CustomFieldType.DATE:          return FilterType.DATE;
            case Contact.CustomFieldType.DATETIME:      return FilterType.DATETIME;
            case Contact.CustomFieldType.BOOLEAN:       return FilterType.BOOLEAN;
            case Contact.CustomFieldType.CHOICE:        return FilterType.ENUM;
            case Contact.CustomFieldType.MULTI_CHOICE:  return FilterType.TAGS;
            case Contact.CustomFieldType.PHONE:         return FilterType.PHONE;
            // TEXT / MULTILINE / URL / EMAIL → free text
            default:                                    return FilterType.STRING;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Build a FilterField for an account custom field so it appears in the catalog alongside the built-ins.
    export function customField( def : Contact.CustomFieldDef ) : FilterField
    {
        return { id: def.uid, label: def.label, type: customFieldFilterType( def.type ), group: def.group ?? "Custom fields", isCustom: true };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Segment (the resource)
    //   DynamoDB: segments  PK: accountId  SK: segmentId
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:           Type.UUID;
        accountId:    Type.UUID;
        ref?:         number;           // per-account sequential reference number (server-assigned on create, immutable, never reused)
        name:         string;
        query:        Query;
        isExclusion?: boolean;          // exclusion segment
        tags?:        Array<string>;    // free-form account tags for organizing segments
        size?:        number;           // current member count (a count, never the member list)
        channelCounts?: Partial<Record<Contact.Channel, number>>;   // sendable-reach per channel (reachable + opted-in), computed at refresh
        // A campaign that builds an audience creates + stores a REAL segment behind the scenes and links it
        // here (`campaignId`) — the campaign→segment indirection. Such segments are `hidden` from the default
        // segments list (they're an implementation detail of the campaign, not a user-managed segment).
        campaignId?:  Type.UUID;         // the campaign that owns/created this segment (if any)
        hidden?:      boolean;           // excluded from the default segments listing (e.g. a campaign-built segment)
        sort?:        Sort;              // result ordering (field + direction) for preview + snapshot — OPTIONAL
        limit?:       number;            // cap membership to the top-N by `sort` (only meaningful WITH a sort)
        status:       Status;            // active | inactive | archived | deleted
        audit:        Contact.AuditMeta;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Segment membership — the contact ↔ segment JOIN (many-to-many). This is the source of truth for
    // membership; `Contact.segmentIds` is only a display cache and `Segment.size` only a count.
    //   DynamoDB: segment_members  PK: segmentKey (`accountId#segmentId`)  SK: contactId
    //     GSI byContact: PK contactKey (`accountId#contactId`), SK segmentId
    //   So "contacts in a segment" and "segments for a contact" are both single Queries (no scans, no
    //   400KB item-size ceiling). MANUAL membership is edited directly (write/delete join rows); QUERY
    //   (dynamic) membership is derived via the search service and only MATERIALIZED here for a run snapshot.
    // ──────────────────────────────────────────────────────────────────────────

    export interface Member
    {
        accountId: Type.UUID;
        segmentId: Type.UUID;
        contactId: Type.UUID;
        source:    MembershipSource;
        addedAt:   Type.ISODateTime;
        addedBy?:  Type.UUID;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Materialization run history — one record per (re)materialization, so "when / who / how many changed" is
    // auditable (a segment can be refreshed many times).
    //   DynamoDB: segment_runs  PK: segmentKey (`accountId#segmentId`)  SK: at (ISO — newest via reverse scan)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Run
    {
        accountId: Type.UUID;
        segmentId: Type.UUID;
        at:        Type.ISODateTime;   // when the run completed
        by?:       Type.UUID;          // who triggered it (create / edit / refresh actor)
        trigger:   RunTrigger;
        status:    RunStatus;
        matched:   number;             // contacts matching the filter (before the top-N limit)
        added:     number;             // QUERY members added this run
        removed:   number;             // QUERY members removed this run
        total:     number;             // effective membership after the run (query + pinned-in, minus pinned-out)
        error?:    string;
    }
}

export default Segment;
// eof
