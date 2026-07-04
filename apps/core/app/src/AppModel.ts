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
//     parsed string or a `Array<flags>` bag.
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

    

    // ══════════════════════════════════════════════════════════════════════════
    // 1) NOTICES & ANNOUNCEMENTS — the one entity the BFF OWNS (app-3)
    // ══════════════════════════════════════════════════════════════════════════

    

    
    

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
        created:   Type.Stamp;
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
        created:         Type.Stamp;
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
