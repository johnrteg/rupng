//
// Marketplace domain model — the integration catalog + control plane: catalog
// definitions, per-account installations, the credential vault, usage metering.
//
// Everything is scoped under the `Marketplace` namespace, so call sites read clearly:
//   Marketplace.IntegrationDefinition, Marketplace.Installation, Marketplace.UsageMeter, ...
//
// Scalars come from `Type` in @repo/common (UUID, ISODateTime, Url, Currency, Json).
//
// Relationships (see SPECS.md "Data model"):
//   IntegrationDefinition (platform-global catalog entry)
//        └─< Installation (account-scoped instance of a definition; 1..N when multiInstance)
//                 ├── credentialRef ──► Credential (vault entry, Secrets Manager + KMS CMK)
//                 └─< UsageMeter (per-instance, per-period counters; SUM → account roll-up)
//
// Storage keys are noted per interface (DynamoDB PK/SK; the vault is Secrets Manager).
//

import type { Type } from "@repo/common";

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
        at:              Type.ISODateTime;
        by:              Type.UUID;
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
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Installation — an account's enabled instance of a definition (account-scoped)
    //   DynamoDB: pk=ACCOUNT#<accountId>  sk=INTEG#<integrationId>[#<instanceId>]   (GSI: by status)
    //   instanceId present only when the definition is multiInstance.
    // ──────────────────────────────────────────────────────────────────────────

    export interface Installation
    {
        accountId:     Type.UUID;
        integrationId: string;             // → IntegrationDefinition.integrationId
        instanceId?:   string;             // only when multiInstance
        label?:        string;             // instance label (multiInstance)

        status:        InstallStatus;
        config:        Type.Json;          // validated against the definition's configSchema
        credentialRef: CredentialRef;      // → vault entry (never the secret)
        health:        Health;

        accepted?:     Acceptance;         // accept-to-enable record (audited)

        installedBy:   Type.UUID;
        installedAt:   Type.ISODateTime;
        disabledAt?:   Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // UsageMeter — per-instance, per-period counters (account roll-up = SUM, no pipeline)
    //   DynamoDB: pk=ACCOUNT#<accountId>  sk=USAGE#<integrationId>#<instanceId>#<period>   (period = YYYY-MM)
    // ──────────────────────────────────────────────────────────────────────────

    export interface UsageMeter
    {
        accountId:     Type.UUID;
        integrationId: string;
        instanceId:    string;
        period:        string;             // YYYY-MM
        calls:         number;
        syncs:         number;
        actions:       number;
        records:       number;
        lastUsedAt:    Type.ISODateTime;
    }

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
