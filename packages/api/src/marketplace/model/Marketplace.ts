//
// Marketplace domain model — the integration catalog + control plane: catalog
// definitions, per-account installations, the credential vault, usage metering.
//
// Everything is scoped under the `Marketplace` namespace, so call sites read clearly:
//   Marketplace.IntegrationDefinition, Marketplace.Installation, Marketplace.UsageMeter, ...
//
// Scalars come from `Type` in @repo/common (UUID, ISODateTime, Url, Currency, Json).
//
// Relationships (see apps/core/marketplace/SPECS.md "Data model"):
//   IntegrationDefinition (platform-global catalog entry)
//        └─< Installation (account-scoped instance of a definition; 1..N when multiInstance)
//                 ├── credentialRef ──► Credential (vault entry, Secrets Manager + KMS CMK)
//                 └─< UsageMeter (per-instance, per-period counters; SUM → account roll-up)
//
// Storage keys are noted per interface (DynamoDB PK/SK; the vault is Secrets Manager).
//
import type { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

export namespace Marketplace
{
    /** SPDX id (`"MIT"`), `"Proprietary"`, or a license URL. */
    export type License = string;

    /** A reference to a vault entry (Secrets Manager key/ARN) — never the secret itself. */
    export type CredentialRef = string;

    /** A JSON-schema for the per-install config the connect UI collects. */
    export type ConfigSchema = Type.Json;

    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    export enum Category
    {
        CRM        = "crm",
        EMAIL      = "email",        // ESP
        ECOMMERCE  = "ecommerce",
        PAYMENTS   = "payments",
        MESSAGING  = "messaging",
        CHAT       = "chat",
        ADS_SOCIAL = "ads_social",
        ANALYTICS  = "analytics",
        ACCOUNTING = "accounting",
        SUPPORT    = "support",
        STORAGE    = "storage",
        FORMS      = "forms",
        CALENDAR   = "calendar",
        AI         = "ai",
        IPAAS      = "ipaas",
    }

    export enum Vertical { POLITICAL = "political", NONPROFIT = "nonprofit", ECOMMERCE = "ecommerce", MARKETING = "marketing" }

    export enum CredentialType { OAUTH = "oauth", API_KEY = "api_key", BASIC = "basic", WEBHOOK = "webhook" }

    export enum CapabilityType { TRIGGER = "trigger", ACTION = "action", SEARCH = "search", SYNC = "sync" }

    /** How a trigger gets its events (webhook, or polling + dedupe for webhook-less APIs). */
    export enum TriggerDelivery { WEBHOOK = "webhook", POLLING = "polling" }

    /** Catalog listing state — controls visibility without deleting the definition. */
    export enum Visibility { AVAILABLE = "available", BETA = "beta", DEPRECATED = "deprecated" }

    /** Usage signals an integration reports (for metering / billing). */
    export enum MeteredSignal { CALLS = "calls", SYNCS = "syncs", ACTIONS = "actions", RECORDS = "records" }

    /** Installation lifecycle (see SPECS.md "Lifecycle"). */
    export enum InstallStatus
    {
        CONFIGURED  = "configured",   // enabled, not yet connected
        ACTIVE      = "active",
        PAUSED      = "paused",       // disabled by the user — config + creds kept
        AUTO_PAUSED = "auto_paused",  // account went inactive
        NEEDS_AUTH  = "needs_auth",   // connect failed / token expired
        REMOVED     = "removed",      // uninstalled — creds purged + revoked
    }

    /** Connection health. */
    export enum HealthState { CONNECTED = "connected", NEEDS_REAUTH = "needs-reauth", ERROR = "error" }

    export enum PriceInterval { MONTH = "month", YEAR = "year" }

    /** Where an integration processes account data — drives the cross-border transfer gate
     *  (marketplace-2.7): an EU account enabling a `US` integration must accept an escalated notice. */
    export enum DataJurisdiction { US = "US", EU = "EU", ALL = "All" }

    /** An installation lifecycle transition — the append-only audit trail (marketplace-2.6/12.2). */
    export enum InstallationAuditAction { ENABLE = "enable", CONFIGURE = "configure", PAUSE = "pause", RESUME = "resume", CONNECT = "connect", REAUTH = "reauth", UNINSTALL = "uninstall" }

    // ──────────────────────────────────────────────────────────────────────────
    // Value objects
    // ──────────────────────────────────────────────────────────────────────────

    export interface Price { amount: number; currency: Type.Currency; interval: PriceInterval; }

    /** Optional paywall — **absent ⇒ free / included**. `plan` gates by tier; `price` bills the add-on. */
    export interface Paywall { plan?: string; price?: Price; }

    /** One capability an integration offers (→ becomes a workflow node). */
    export interface Capability
    {
        type:          CapabilityType;     // trigger | action | search | sync
        key:           string;             // e.g. "invoice.created" / "create_invoice"
        name:          string;
        description?:  string;
        delivery?:     TriggerDelivery;    // triggers: webhook vs polling (+ dedupe)
        findOrCreate?: boolean;            // search: supports find-or-create
        bulkBackfill?: boolean;            // sync: seed existing records on connect
    }

    /** Install-time acceptance of the provider's terms — audited (which / who / when). */
    export interface Acceptance
    {
        license?:        License;
        termsUrl?:       Type.Url;
        privacyUrl?:     Type.Url;
        subProcessorAck: boolean;          // data-sharing / sub-processor acknowledgment (accept-to-enable)
        crossBorderAck?: boolean;          // escalated EU→US transfer notice — required when the integration's
                                            // dataJurisdiction is US (marketplace-2.7); see PostInstallationEnableImpl
        at:              Type.ISODateTime;
        by:              Type.UUID;
    }

    /** One installation lifecycle transition — the append-only audit trail. */
    export interface InstallationAudit
    {
        installationId: Type.UUID;
        seq:            number;
        action:         InstallationAuditAction;
        by:             Type.UUID;
        at:             Type.ISODateTime;
        detail?:        string;
    }

    export interface Health { state: HealthState; checkedAt?: Type.ISODateTime; error?: string; }

    // ──────────────────────────────────────────────────────────────────────────
    // IntegrationDefinition — the catalog entry (platform-global)
    //   DynamoDB: pk=DEF#<integrationId>
    // ──────────────────────────────────────────────────────────────────────────

    export interface IntegrationDefinition
    {
        integrationId:  string;            // slug/id, e.g. "hubspot"
        name:           string;
        provider:       string;            // vendor / company

        category:       Category;
        verticals:      Array<Vertical>;
        description:    string;
        icon:           string;            // S3 key or URL
        website?:       Type.Url;
        docsUrl?:       Type.Url;

        // technical
        capabilities:   Array<Capability>;
        credentialType: CredentialType;
        configSchema:   ConfigSchema;

        // commerce & access
        paywall?:       Paywall;           // absent ⇒ free
        license:        License;
        termsUrl?:      Type.Url;
        privacyUrl?:    Type.Url;
        visibility:     Visibility;
        multiInstance?: boolean;           // several installs per account (default single)
        metered?:       Array<MeteredSignal>;
        dataJurisdiction: DataJurisdiction; // where this integration processes account data (marketplace-1.2)
    }

    const CAPABILITY_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "type", "key", "name" ],
        properties: {
            type:         { type: "string", enum: Object.values( CapabilityType ) },
            key:          { type: "string" },
            name:         { type: "string" },
            description:  { type: "string" },
            delivery:     { type: "string", enum: Object.values( TriggerDelivery ) },
            findOrCreate: { type: "boolean" },
            bulkBackfill: { type: "boolean" },
        },
    };

    /** Validate an `IntegrationDefinition` (a catalog entry, platform-global). */
    export const CATALOG_SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "integrationId", "name", "provider", "category", "verticals", "description", "icon", "capabilities", "credentialType", "configSchema", "license", "visibility", "dataJurisdiction" ],
        properties:
        {
            integrationId:  { type: "string" },
            name:           { type: "string" },
            provider:       { type: "string" },
            category:       { type: "string", enum: Object.values( Category ) },
            verticals:      { type: "array", items: { type: "string", enum: Object.values( Vertical ) } },
            description:    { type: "string" },
            icon:           { type: "string" },
            website:        { type: "string" },
            docsUrl:        { type: "string" },
            capabilities:   { type: "array", items: CAPABILITY_SCHEMA },
            credentialType: { type: "string", enum: Object.values( CredentialType ) },
            configSchema:   { type: "object" },
            paywall:        { type: "object", additionalProperties: false, properties: {
                plan:  { type: "string" },
                price: { type: "object", additionalProperties: false, required: [ "amount", "currency", "interval" ], properties: {
                    amount: { type: "number" }, currency: { type: "string" }, interval: { type: "string", enum: Object.values( PriceInterval ) },
                } },
            } },
            license:        { type: "string" },
            termsUrl:       { type: "string" },
            privacyUrl:     { type: "string" },
            visibility:     { type: "string", enum: Object.values( Visibility ) },
            multiInstance:  { type: "boolean" },
            metered:        { type: "array", items: { type: "string", enum: Object.values( MeteredSignal ) } },
            dataJurisdiction: { type: "string", enum: Object.values( DataJurisdiction ) },
        },
    };

    /** Validate a `Marketplace.IntegrationDefinition` (a wire payload, a DynamoDB row). */
    export const validateCatalog : Validation.Validator<IntegrationDefinition> = Validation.compile<IntegrationDefinition>( CATALOG_SCHEMA );

    // ──────────────────────────────────────────────────────────────────────────
    // Installation — an account's enabled instance of a definition (account-scoped)
    //   DynamoDB: pk=ACCOUNT#<accountId>  sk=INTEG#<integrationId>[#<instanceId>]   (GSI: by status)
    //   instanceId present only when the definition is multiInstance.
    // ──────────────────────────────────────────────────────────────────────────

    export interface Installation
    {
        installationId: Type.UUID;         // server-assigned id (also the OAuth broker connectionKey)
        accountId:     Type.UUID;
        integrationId: string;             // → IntegrationDefinition.integrationId (also the OAuth provider key)
        instanceId?:   string;             // only when multiInstance
        label?:        string;             // instance label (multiInstance)

        status:        InstallStatus;
        config:        Type.Json;          // validated against the definition's configSchema
        credentialRef?: CredentialRef;     // → vault entry (never the secret); absent while broker-managed (Nango)
        externalRef?:  string;             // the provider's OWN id for this connection (e.g. a Shopify shop
                                            // domain) — an inbound webhook carries no installationId of its
                                            // own, so `PostMarketplaceWebhookImpl` resolves the owning
                                            // installation from this via the `byExternalRef` GSI (cross-account,
                                            // mirrors social's `connections.byId`); set at connect time.
        health:        Health;

        accepted?:     Acceptance;         // accept-to-enable record (audited)

        installedBy:   Type.UUID;
        installedAt:   Type.ISODateTime;
        disabledAt?:   Type.ISODateTime;
    }

    /**
     * Read-time DEFAULTs — the safe baseline for fields an older / partial `Installation` row may be
     * missing. Identity fields (`installationId`, `accountId`, `integrationId`, `installedBy`,
     * `installedAt`) are OMITTED — a row missing those is an anomaly to surface, not fabricate.
     */
    export const DEFAULT : Partial<Installation> =
    {
        status: InstallStatus.CONFIGURED,
        config: {},
        health: { state: HealthState.ERROR },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "installationId", "accountId", "integrationId", "status", "config", "health", "installedBy", "installedAt" ],
        properties:
        {
            installationId: { type: "string", format: "uuid" },
            accountId:       { type: "string", format: "uuid" },
            integrationId:   { type: "string" },
            instanceId:      { type: "string" },
            label:           { type: "string" },
            status:          { type: "string", enum: Object.values( InstallStatus ) },
            config:          { type: "object" },
            credentialRef:   { type: "string" },
            externalRef:     { type: "string" },
            health:
            {
                type: "object", additionalProperties: false, required: [ "state" ],
                properties: {
                    state:     { type: "string", enum: Object.values( HealthState ) },
                    checkedAt: { type: "string" },
                    error:     { type: "string" },
                },
            },
            accepted:
            {
                type: "object", additionalProperties: false, required: [ "subProcessorAck", "at", "by" ],
                properties: {
                    license:        { type: "string" },
                    termsUrl:       { type: "string" },
                    privacyUrl:     { type: "string" },
                    subProcessorAck: { type: "boolean" },
                    crossBorderAck: { type: "boolean" },
                    at:             { type: "string" },
                    by:             { type: "string" },
                },
            },
            installedBy: { type: "string", format: "uuid" },
            installedAt: { type: "string", format: "date-time" },
            disabledAt:  { type: "string", format: "date-time" },
        },
    };

    /** Validate a `Marketplace.Installation` (a wire payload, a DynamoDB row). */
    export const validate : Validation.Validator<Installation> = Validation.compile<Installation>( SCHEMA );

    // ──────────────────────────────────────────────────────────────────────────
    // UsageMeter — per-instance, per-period counters (account roll-up = SUM, no pipeline)
    //   DynamoDB: pk=accountId  sk=meterKey (`<integrationId>#<instanceId ?? "_">#<period>`, period = YYYY-MM)
    // ──────────────────────────────────────────────────────────────────────────

    export interface UsageMeter
    {
        accountId:     Type.UUID;
        integrationId: string;
        instanceId?:   string;              // only when the definition is multiInstance
        period:        string;              // YYYY-MM
        meterKey:      string;              // the table's sort key — see above
        calls:         number;
        syncs:         number;
        actions:       number;
        records:       number;
        lastUsedAt:    Type.ISODateTime;
    }

    /** The composite sort key for a `UsageMeter` row. */
    export function usageMeterKey( integrationId : string, instanceId : string | undefined, period : string ) : string
    {
        return `${integrationId}#${instanceId ?? "_"}#${period}`;
    }

    /** Read-time DEFAULTs for `UsageMeter` — identity fields are OMITTED (see the `Installation.DEFAULT` note). */
    export const USAGE_DEFAULT : Partial<UsageMeter> = { calls: 0, syncs: 0, actions: 0, records: 0 };

    export const USAGE_SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "accountId", "integrationId", "period", "meterKey", "calls", "syncs", "actions", "records", "lastUsedAt" ],
        properties:
        {
            accountId:     { type: "string", format: "uuid" },
            integrationId: { type: "string" },
            instanceId:    { type: "string" },
            period:        { type: "string" },
            meterKey:      { type: "string" },
            calls:         { type: "number" },
            syncs:         { type: "number" },
            actions:       { type: "number" },
            records:       { type: "number" },
            lastUsedAt:    { type: "string", format: "date-time" },
        },
    };

    /** Validate a `Marketplace.UsageMeter` (a wire payload, a DynamoDB row). */
    export const validateUsage : Validation.Validator<UsageMeter> = Validation.compile<UsageMeter>( USAGE_SCHEMA );

    // ──────────────────────────────────────────────────────────────────────────
    // Credential — the vault entry (Secrets Manager, KMS CMK per account)
    //   Secrets Manager: marketplace/<accountId>/<integrationId>[/<instanceId>]
    //   Held only as a reference (CredentialRef) on the Installation; decrypted on use.
    // ──────────────────────────────────────────────────────────────────────────

    export interface Credential
    {
        type:           CredentialType;
        accessToken?:   string;            // oauth
        refreshToken?:  string;            // oauth
        expiresAt?:     Type.ISODateTime;  // oauth — auto-refresh before this
        apiKey?:        string;            // api_key
        signingSecret?: string;            // webhook
        scopes?:        Array<string>;     // least-privilege granted scopes
    }

    // ──────────────────────────────────────────────────────────────────────────
    // API payloads
    // ──────────────────────────────────────────────────────────────────────────

    /** Enable an integration — accept-to-enable (POST /marketplace/installations). */
    export interface EnableRequest
    {
        integrationId: string;
        instanceId?:   string;             // multiInstance
        label?:        string;
        config:        Type.Json;
        accept:        Acceptance;         // required — no enable without acceptance
    }

    /** Connect result — OAuth returns a redirect URL; API-key returns validated. */
    export interface ConnectResult { authorizeUrl?: Type.Url; validated?: boolean; }
}

export default Marketplace;
// eof
