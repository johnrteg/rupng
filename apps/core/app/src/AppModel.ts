//
// App (web BFF) domain model — the client-shell surface: the ONE owned entity
// (notices / announcements) plus the assembled read-models + intake DTOs the BFF
// serves (bootstrap config, feature flags, telemetry / product-event intake, and the
// customer-support glue).
//
// Everything is scoped under the `App` namespace. Scalars come from `Type` in
// @repo/common (ID, ISODateTime, JsonObject); the role ladder from `Access` in
// @repo/endpoint.
//
// Design tenets carried from SPECS.md (cited inline as `app-N.M`):
//   • The BFF is a READ-MODEL AGGREGATOR + INTAKE — it OWNS only the notices datastore
//     (app-3 / app-10.2); everything else here is assembled or intake, not a source of truth.
//   • TYPED, not stringly — audience / placement / class are typed unions + enums, never a
//     parsed string or a `flags[]` bag.
//   • PUBLIC-SAFE — the bootstrap read-model carries no secrets + no PII (app-1.4); only
//     *publishable* keys. Served fresh / no stale TTL (app-9.1).
//   • PII-LIGHT INTAKE — telemetry is scrubbed before storage (app-5.3); product events carry
//     ids + non-PII props.
//
// Storage notes (PK/SK) are DynamoDB-shaped; the notices/dismissals/page-share tables are
// app-owned. Tickets are provider-owned (factory) — what's here is the projection.
//

import type { Type }   from "@repo/common";
import type { Access } from "@repo/endpoint";

export namespace App
{
    // ──────────────────────────────────────────────────────────────────────────
    // Shared
    // ──────────────────────────────────────────────────────────────────────────

    /** Who + when, for audit ({at,by} group). `by` is the actor's user id. */
    export interface Stamp { at: Type.ISODateTime; by: Type.ID; }

    // ══════════════════════════════════════════════════════════════════════════
    // 1) NOTICES & ANNOUNCEMENTS — the one entity the BFF OWNS (app-3)
    // ══════════════════════════════════════════════════════════════════════════

    /** What kind of message it is — drives where/how the client surfaces it (app-3.1). */
    export enum NoticeClass
    {
        SYSTEM    = "system",     // maintenance / outage / holiday hours (incl. the version-gate, app-3.5)
        MARKETING = "marketing",
        SUPPORT   = "support",
        OFFER     = "offer",
        WEBINAR   = "webinar",
    }

    /** Urgency — drives client styling (app-3.1). */
    export enum Severity { ERROR = "error", WARNING = "warning", INFO = "info" }

    /**
     * Where the notice renders — the at-login vs in-app selector (app-3.1).
     * `login` rides the PUBLIC bootstrap blob (pre-auth, public-safe); `banner`/`center`
     * come from the AUTHED `/app/notices` endpoint (app-3.3 / 3.4).
     */
    export enum Placement
    {
        LOGIN  = "login",     // pre-auth login screen — embedded in GET /app/bootstrap → notices[]
        BANNER = "banner",    // global in-app banner
        CENTER = "center",    // in-app notification list
    }

    export enum AudienceKind { PLATFORM = "platform", ACCOUNT = "account", WHITELABEL = "whitelabel", ROLE = "role" }

    /**
     * Who sees the notice (app-3.1) — a TYPED union, not a parsed string.
     * `platform` is staff-authored only (app-3.8); `account`/`whitelabel` are auto-scoped when an
     * account admin authors (the bootstrap is keyed by `Host` → account, so login-placement scoping
     * is automatic). `role` targets everyone at/above a role on the `Access` ladder.
     * Example: `{ kind: "whitelabel", subdomain: "acme" }` · `{ kind: "role", role: Access.AccountRole.BILLING }`
     */
    export type NoticeAudience =
        | { kind: AudienceKind.PLATFORM }
        | { kind: AudienceKind.ACCOUNT;    accountId: Type.ID }
        | { kind: AudienceKind.WHITELABEL; subdomain: string }
        | { kind: AudienceKind.ROLE;       role: Access.Role };

    /**
     * Active window (app-3.1) — **UTC instants + an IANA `timeZone`** for authoring/display, per the
     * platform time discipline ("holiday hours Dec 24–26 ET" stored UTC, shown in zone). A notice is
     * "active now" when `paused == false AND now ∈ [start,end] AND audience matches` (app-3.2).
     */
    export interface NoticeWindow { start: Type.ISODateTime; end: Type.ISODateTime; timeZone: string; }

    /** Optional call-to-action — a **tracked-links** URL so offer/webinar clicks attribute (app-3.1). */
    export interface NoticeCta { label: string; url: string; }   // url = links-service tracked URL

    /**
     * A notice / announcement (app-3.1). `title`/`body` are **server-sanitized HTML** via the shared
     * `Application.sanitizeHtml` "vanilla" profile (app-8.4) — sanitized on **store *and* render**.
     * `paused` is the admin kill-switch (excluded regardless of window). Authored in the in-app
     * role-gated Tools section (app-3.6).
     *   PK: accountId | "platform"   SK: noticeId
     */
    export interface Notice
    {
        id:          Type.ID;
        class:       NoticeClass;
        severity:    Severity;
        title:       string;          // sanitized HTML (app-8.4)
        body:        string;          // sanitized HTML (app-8.4)
        placement:   Placement;
        window:      NoticeWindow;
        audience:    NoticeAudience;
        paused:      boolean;          // pause WITHOUT deleting (app-3.6)
        dismissible: boolean;          // may the user dismiss it (and is it remembered — app-3.7)
        cta?:        NoticeCta;
        locale?:     string;           // BCP-47 — localized title/body variant (app-3.9)
        created:     Stamp;
        updated:     Stamp;
    }

    /**
     * A per-user dismissal of a dismissible notice (app-3.7). Residual decision: client-local vs
     * server-synced; this is the **server-synced** shape (follows the user across devices).
     *   PK: userId   SK: noticeId
     */
    export interface NoticeDismissal { userId: Type.ID; noticeId: Type.ID; at: Type.ISODateTime; }

    // ══════════════════════════════════════════════════════════════════════════
    // 2) BOOTSTRAP — the assembled PUBLIC read-model (app-1). NOT owned: assembled
    //    from account (branding/flags) + auth (password policy) + AppConfig (keys/limits).
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * A feature-flag value. A **boolean** is a simple on/off; a **string** is an A/B **variant**
     * label (the cohort assignment — app-2.4: an experiment is a flag variant, no separate service);
     * a **number** supports staged percentages / numeric gates.
     */
    export type FlagValue = boolean | string | number;

    /** Effective flag set after merging platform (AppConfig) ⊕ account (account override wins, app-2.3). */
    export type FeatureFlags = { [flagKey: string]: FlagValue };

    /** Per-whitelabel branding (public-safe subset; SoT = account). */
    export interface Branding { subdomain: string; displayName: string; logoUrl?: string; colors?: Type.JsonObject; }

    /** Public projection of the password policy (SoT = auth; client enforces, auth re-enforces server-side). */
    export interface PasswordPolicy
    {
        minLength:      number;
        requireUpper?:  boolean;
        requireLower?:  boolean;
        requireNumber?: boolean;
        requireSymbol?: boolean;
    }

    export interface UploadLimits { maxFileBytes: number; allowedMimeTypes: Array<string>; }

    /** **Publishable** keys ONLY — never secrets (app-1.4). */
    export interface PublishableKeys { stripePublishable?: string; recaptchaSiteKey?: string; mapsKey?: string; }

    /**
     * The public, pre-auth startup blob the SPA reads (app-1.2) — **served fresh / no stale TTL**
     * (app-9.1), keyed by validated `Host` (app-1.5). **No secrets, no PII** (app-1.4).
     */
    export interface BootstrapConfig
    {
        branding:        Branding;
        name:            string;
        passwordPolicy:  PasswordPolicy;
        uploadLimits:    UploadLimits;
        publishableKeys: PublishableKeys;
        featureFlags:    FeatureFlags;
        version:         string;             // drives the version-gate (app-3.5)
        locale:          string;             // resolved BCP-47 (app-3.9)
        notices:         Array<Notice>;      // active LOGIN-placement notices only (public-safe)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3) TELEMETRY & ANALYTICS INTAKE — two streams to two sinks (app-5 / app-6)
    // ══════════════════════════════════════════════════════════════════════════

    /** RUM / engineering-telemetry kinds → monitor (app-5.1). */
    export enum TelemetryKind
    {
        WEB_VITAL    = "web_vital",     // LCP / INP / CLS / FCP / TTFB
        JS_ERROR     = "js_error",      // window.onerror / unhandledrejection / ErrorBoundary
        API_TIMING   = "api_timing",    // a /<service>/* call's browser-side latency + status
        ROUTE_CHANGE = "route_change",  // SPA route timing / session journey
    }

    /**
     * One RUM / error intake event (app-5.2). **PII-SCRUBBED before storage** (app-5.3): query params
     * stripped, PII masked, auth headers/tokens dropped from URLs / payloads / stacks. Enriched with
     * `transactionId` for backend correlation (X-Ray / monitor, app-5.4), then forwarded to monitor.
     */
    export interface TelemetryEvent
    {
        kind:           TelemetryKind;
        at:             Type.ISODateTime;
        transactionId?: Type.ID;          // backend correlation (app-5.4)
        data:           Type.JsonObject;  // scrubbed vital values / error{message,stack} / timing
    }

    /**
     * A first-party product-behavior event (app-6.1) → Kafka → analytics. **Identity-tied** for funnels /
     * attribution (app-6.3); **stored in-app, never shared/sold** (app-6.2) — NOT Google Analytics.
     * `name` is a domain event, e.g. "campaign.created" / "report.run" / "onboarding.step.completed".
     */
    export interface ProductEvent
    {
        name:      string;
        accountId: Type.ID;
        userId:    Type.ID;
        at:        Type.ISODateTime;
        props?:    Type.JsonObject;       // PII-light props
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4) CUSTOMER-SUPPORT GLUE — Zendesk proxy · page sharing · ticketing (app-4)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * A help article fetched via the BFF proxy by **id only** (no user-supplied URL — SSRF-safe, app-8.6);
     * `body` is **server-sanitized HTML** (app-4.1). The server holds the base URL + token (Secrets Manager).
     */
    export interface HelpArticle
    {
        id:        Type.ID;
        title:     string;
        body:      string;              // sanitized HTML
        htmlUrl:   string;
        updatedAt: Type.ISODateTime;
        locale?:   string;              // locale-aware fetch (app-4.4)
    }

    export enum PageShareStatus { ACTIVE = "active", STOPPED = "stopped", EXPIRED = "expired" }

    /**
     * A page-share session (app-4.2) — hands support the user's current route + app-state + ids.
     * **Explicit + user-initiated**, **stoppable anytime** (→ STOPPED), short-retained / **auto-expired**
     * (`expiresAt`), and audited. (Live co-browse, if added, is a Zendesk JS-SDK — no plugin — app-4.5.)
     *   PK: accountId   SK: shareId   (TTL on expiresAt)
     */
    export interface PageShare
    {
        id:        Type.ID;
        accountId: Type.ID;
        userId:    Type.ID;
        route:     string;
        ids?:      Type.JsonObject;     // context ids the user is looking at
        state?:    Type.JsonObject;     // captured app-state snapshot
        status:    PageShareStatus;
        created:   Stamp;
        expiresAt: Type.ISODateTime;
    }

    /** Ticket providers — the factory (Zendesk-first; Freshdesk/Intercom by AppConfig, app-4.3 / app-11.7). */
    export enum TicketProvider { ZENDESK = "zendesk", FRESHDESK = "freshdesk", INTERCOM = "intercom" }

    export enum TicketStatus { OPEN = "open", PENDING = "pending", SOLVED = "solved", CLOSED = "closed" }

    /** A support ticket — provider-abstracted projection (the provider owns the record). */
    export interface SupportTicket
    {
        id:              Type.ID;
        provider:        TicketProvider;
        externalId?:     string;          // the provider's ticket id
        subject:         string;
        body:            string;
        requesterUserId: Type.ID;
        status:          TicketStatus;
        created:         Stamp;
    }

    /** Why a ticket is being opened — the reasons `AppTicketJob` drains off SQS (app-11.5). */
    export enum TicketReason { PENDING_REVIEW = "pending_review", BILLING = "billing", DUNNING = "dunning", SUPPORT = "support" }

    /**
     * SQS message consumed by **`AppTicketJob`** (app-11.5) — e.g. a registration `pending_review` flag
     * from access-flows, or a billing/dunning enqueue → open a ticket via the factory (retries + DLQ, so a
     * provider outage never blocks signup).
     */
    export interface TicketRequest
    {
        reason:     TicketReason;
        accountId?: Type.ID;
        userId?:    Type.ID;
        subject:    string;
        body:       string;
        context?:   Type.JsonObject;
    }
}

export default App;
