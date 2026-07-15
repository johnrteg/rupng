//
// Texting domain model — SMS/MMS send + receive, the conversation/inbox, number
// routing, scoped suppression, the typed gating result, agent workflow, and stats.
//
// Everything is scoped under the `Texting` namespace. Scalars come from `Type` in
// @repo/common (ID, ISODateTime, PhoneE164, Currency, Json); the role ladder from
// `Access` in @repo/endpoint.
//
// Design tenets carried from SPECS.md (cited inline as `texting-N.M`):
//   • TYPED, not stringly — no `Array<flags>` bag, no magic status integers (texting-5.11 / 20.2).
//     Each concern is its own typed attribute on the right entity.
//   • The NUMBER RECORD is the pivot — number → provider → creds → TCR (texting-4.6).
//   • Normalize at the edges — the adapter speaks provider dialect; everything inboard
//     reasons about normalized status / errcode / outcome (texting-16.2).
//   • Suppression is SCOPED structured data, not `dnd:<channel>` suffix strings (texting-5.12).
//
// Storage notes (PK/SK) are DynamoDB-shaped; the conversation/send-log is texting-owned,
// numbers are provisioned in registration (texting-4.5), suppression SoT is contact.
//

import type { Type }   from "@repo/common";
import type { Access } from "@repo/endpoint";

export namespace Texting
{
    // ──────────────────────────────────────────────────────────────────────────
    // Enums / unions — the normalized vocabulary (texting-3.3 UDF, 16.2)
    // ──────────────────────────────────────────────────────────────────────────

    /** Supported send providers (CPaaS). `*3` = a distinct account/config of the same vendor (texting-3.1). */
    export enum Provider
    {
        BANDWIDTH   = "bandwidth",
        BANDWIDTH3  = "bandwidth3",   // distinct Bandwidth account/config, separate number pool
        BROADNET    = "broadnet",
        INFOBIP     = "infobip",
        SIGNALWIRE  = "signalwire",
        SINCH       = "sinch",
        TELNYX      = "telnyx",
        TELNYX3     = "telnyx3",      // distinct Telnyx account/config
        TWILIO      = "twilio",
        VONAGE      = "vonage",
        FAKE        = "fake",         // test-only: simulates DLR / inbound / STOP at scale (texting-3.2)
    }

    /** Destination mobile networks we track per-carrier (texting-5.6). `provider ≠ carrier` (texting-4.8). */
    export enum Carrier
    {
        ATT          = "att",
        VERIZON      = "verizon",
        TMOBILE      = "tmobile",
        US_CELLULAR  = "us_cellular",
        UNKNOWN      = "unknown",     // carrierId regex didn't resolve — treat conservatively
    }

    /** Number kinds, each with its own carrier throughput profile (texting-4.1). */
    export enum NumberType { LONG_CODE = "long_code", TOLL_FREE = "toll_free", SHORT_CODE = "short_code" }

    export enum MessageType { SMS = "sms", MMS = "mms" }
    export enum Direction   { OUTBOUND = "outbound", INBOUND = "inbound" }

    /**
     * The **UDF normalized** delivery status (texting-3.3). Each adapter maps its provider's
     * many raw codes onto this one vocabulary; the raw `providerCode` is retained for audit.
     * `unknown` is the DLR-never-arrived timeout bucket — never block on it (texting-6.2).
     */
    export enum DeliveryStatus
    {
        QUEUED      = "queued",
        SENT        = "sent",
        DELIVERED   = "delivered",
        UNDELIVERED = "undelivered",
        FAILED      = "failed",
        UNKNOWN     = "unknown",
    }

    /**
     * Normalized error category from the classifier (texting-6.5): raw `msgcode` → `errcode`.
     * Routed to the right TYPED target (texting-6.5): deliverability blocks → contact `suppression`,
     * `invalid` → sending-number `health`. Config-driven `<provider>-codes-map`, specificity cascade.
     */
    export enum ErrCode
    {
        INVALID       = "invalid",        // bad sending number → bench it (texting-5.7)
        SPAM          = "spam",           // carrier flagged spam → bench for that carrier
        NOCARRIER     = "nocarrier",      // no route to carrier
        DND           = "dnd",            // recipient opted out
        BAD           = "bad",            // generic bad/wrong number
        LANDLINE      = "landline",       // not SMS-capable
        UNREACHABLE   = "unreachable",
        DEACT         = "deact",          // deactivated number
        TEMP          = "temp",           // transient — leave retryable
        IGNORE        = "ignore",         // benign provider noise → swallow → treat as delivered
        OVER_CAPACITY = "over_capacity",  // rate limited
    }

    // ──────────────────────────────────────────────────────────────────────────
    // The typed gating RESULT — replaces the legacy magic 600/601/602 (texting-17.1 / 20.2)
    // ──────────────────────────────────────────────────────────────────────────

    /** What the gating pipeline decided for a message (texting-17.1). */
    export enum Outcome
    {
        BLOCK   = "block",     // pre-enqueue hard error to the caller (403/429); nothing queued
        SKIP    = "skip",      // suppressed but logged with a reason; terminal
        DROP    = "drop",      // discarded mid-send; terminal
        REQUEUE = "requeue",   // transient — re-scheduled (backpressure), no failure recorded
        SEND    = "send",      // passed all gates → hits the provider
    }

    /** Why a message was REQUEUEd (texting-20.2 — typed, not magic 6xx; legacy code in comments). */
    export enum RequeueReason
    {
        PROVIDER_UNAVAILABLE = "provider_unavailable",  // provider 429/5xx / DB lag   (legacy 600)
        OUT_OF_WINDOW        = "out_of_window",         // outside the send window      (legacy 601)
        CARRIER_PAUSED       = "carrier_paused",        // carrier pause active          (legacy 602)
    }

    /** Why a message was SKIPped/BLOCKed/DROPped (the Stage-A / send-time terminal reasons, texting-17.2/17.3). */
    export enum GateReason
    {
        BALANCE         = "balance",         // BLOCK — no funds / max_out (texting-11.5)
        TIMERANGE       = "timerange",       // SKIP  — outside allowed hours
        UNREACHABLE     = "unreachable",     // SKIP
        NOCARRIER       = "nocarrier",       // SKIP / DROP — landline / benched carrier
        DAILYCAP        = "dailycap",        // SKIP  — TCR/brand daily cap (texting-5.9)
        SUPPRESSED      = "suppressed",      // SKIP  — dnd / hard_block (compliance, texting-5.10)
        INVALID_NUMBER  = "invalid_number",  // DROP  — benched sending number (texting-5.7)
        CARRIER_DISCARD = "carrier_discard", // DROP  — carrier discard window (texting-5.8)
    }

    /**
     * The result of trying to send one message — the single typed shape every gate/worker returns.
     * Example (throttled): `{ outcome: REQUEUE, requeueReason: PROVIDER_UNAVAILABLE, retryAfterMs: 1500 }`
     * Example (opted out): `{ outcome: SKIP, gateReason: SUPPRESSED }`
     * Example (sent):      `{ outcome: SEND, messageId: "…", segments: 2 }`
     */
    export interface SendResult
    {
        outcome:        Outcome;
        requeueReason?: RequeueReason;   // when outcome=REQUEUE
        gateReason?:    GateReason;      // when outcome=SKIP/BLOCK/DROP
        retryAfterMs?:  number;          // computed-delay backpressure ≈ token-bucket refill (texting-20.7)
        messageId?:     Type.ID;         // when outcome=SEND
        segments?:      number;          // billed segments (texting-2.5)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Typed tags & state — NOT one `Array<flags>` bag (texting-5.11). One mission per field.
    // ──────────────────────────────────────────────────────────────────────────

    // ── suppression (contact-owned SoT; texting reads it via canSend) ───────────

    export enum SuppressionReason
    {
        OPT_OUT     = "opt_out",      // recipient STOP
        HARD_BLOCK  = "hard_block",   // permanent block
        UNREACHABLE = "unreachable",
        LANDLINE    = "landline",
        DEACTIVATED = "deactivated",
    }

    export enum ScopeLevel { GLOBAL = "global", NUMBER = "number", BRAND = "brand", CAMPAIGN = "campaign" }

    /**
     * Where a suppression applies — the structured replacement for legacy `dnd:<channel>` suffix
     * strings (texting-5.12). `global` suppresses everywhere; a scoped record only blocks sends
     * matching that number / brand / campaign.
     * Example (split-DND): `{ level: "brand", id: "brand_A" }`  ·  global: `{ level: "global" }`
     */
    export type SuppressionScope =
        | { level: ScopeLevel.GLOBAL }
        | { level: ScopeLevel.NUMBER;   id: Type.PhoneE164 }
        | { level: ScopeLevel.BRAND;    id: Type.ID }
        | { level: ScopeLevel.CAMPAIGN; id: Type.ID };

    export enum SuppressionSource { RECIPIENT_STOP = "recipient_stop", PROVIDER = "provider", AGENT = "agent", IMPORT = "import" }

    /**
     * One scoped suppression record (texting-5.10/5.12). A contact carries a LIST of these.
     * A send is blocked if any record matches `channel == sms AND (scope.level == global OR
     * scope.id ∈ {thisNumber, thisBrand, thisCampaign})`. Carries provenance for compliance proof.
     */
    export interface SuppressionRecord
    {
        channel:  "sms";                 // per-channel — SMS opt-out ≠ email opt-out
        reason:   SuppressionReason;
        scope:    SuppressionScope;
        source:   SuppressionSource;
        at:       Type.ISODateTime;
        keyword?: string;                // the opt-out keyword captured, e.g. "STOP" — audit
    }

    // ── number health (on the number record, texting-5.7 / 20.6) ────────────────

    export enum NumberHealthState { OK = "ok", BENCHED = "benched" }

    /**
     * Sending-number health — a DIFFERENT typed target from contact suppression (texting-6.5).
     * `invalid` errcode benches globally; `nocarrier`/`spam` bench for one carrier only.
     * Lives in Redis (SoT) + pub/sub invalidation, not an in-memory fleet broadcast (texting-20.6).
     */
    export interface NumberHealth
    {
        state:         NumberHealthState;
        reason?:       ErrCode;          // why benched (invalid / nocarrier / spam)
        carrier?:      Carrier;          // set when the bench is carrier-scoped
        benchedUntil?: Type.ISODateTime; // 24h TTL default
    }

    // ── lifecycle + labels (conversation/contact) ───────────────────────────────

    /** Conversation/contact lifecycle — a typed enum, not lifecycle strings in a bag. */
    export enum Lifecycle { NEW = "new", ACTIVE = "active", REPLIED = "replied", OPTED_IN = "opted_in", OPTED_OUT = "opted_out" }

    /** Agent-set triage labels (account-defined). e.g. ["interested","callback"]. NOT suppression. */
    export type Label = string;

    // ──────────────────────────────────────────────────────────────────────────
    // Number record — THE PIVOT (texting-4.6). Provisioned in registration (texting-4.5);
    // texting resolves it at send (the getProxy step) to pick adapter + creds + TCR identity.
    //   pk=ACCOUNT#<accountId>  sk=NUMBER#<e164>
    // ──────────────────────────────────────────────────────────────────────────

    export enum NumberStatus { ACTIVE = "active", PENDING = "pending", RELEASED = "released", SUSPENDED = "suspended" }

    /** The TCR / 10DLC identity bound to a number (registration owns registration; texting consumes). */
    export interface TcrIdentity { brandId?: Type.ID; campaignId?: Type.ID; cspId?: Type.ID; }

    export interface NumberRecord
    {
        accountId:     Type.ID;
        number:        Type.PhoneE164;     // the from-number — the binding to provider + creds
        type:          NumberType;
        provider:      Provider;           // a number lives on ONE provider (texting-3.4)
        configSet?:    string;             // named provider config-set (e.g. "prod") — texting-4.7 tier A
        carrierMps?:   number;             // per-number carrier MPS (from registration trust score, texting-4.4)
        tcr:           TcrIdentity;
        status:        NumberStatus;
        health:        NumberHealth;       // bench state (texting-5.7)
        voiceCapable?: boolean;            // numbers can forward voice (cross-service, adjacent)
        // per-number credential OVERRIDES live in the marketplace/registration vault, referenced by id —
        // endpoints/hosts are NOT here (they're in adapter code, texting-3.8)
        credentialRef?: Type.ID;
    }

    /**
     * How a campaign routes over its **TCR 10DLC campaign number group** — the "parent number" selector
     * (texting-4.10). Sets the ELIGIBLE SET for an INITIAL send; sticky-first still overrides (continuity),
     * then round-robin/LRU within the set; replies stay pinned (texting-4.3.3).
     */
    export enum NumberSelectionMode
    {
        ALL       = "all",        // the parent / whole group — round-robin across every number
        AREA_CODE = "area_code",  // round-robin across the SUBSET of the group in a specified NPA (a subset of ALL)
        SINGLE    = "single",     // one specific number
        // a set/subset of ONE number just routes there; whichever number is picked becomes the contact's STUCK number
    }

    /**
     * A campaign's number-selection config over its registered group (texting-4.10).
     * Example: `{ mode: ALL }` · `{ mode: SINGLE, number: "+1512..." }` · `{ mode: AREA_CODE, areaCode: "512" }`
     */
    export interface NumberSelection
    {
        mode:       NumberSelectionMode;
        number?:    Type.PhoneE164;   // when mode = SINGLE
        areaCode?:  string;           // NPA, when mode = AREA_CODE
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Provider adapter — a TYPED interface (texting-20.1), not runtime string dispatch.
    // Adding a provider = a class the compiler forces to be complete.
    // ──────────────────────────────────────────────────────────────────────────

    export interface OutboundRequest
    {
        from:           Type.PhoneE164;
        to:             Type.PhoneE164;
        body?:          string;
        mediaUrls?:     Array<Type.Url>;   // MMS — public-signed media URLs the carrier fetches (texting-2.3)
        idempotencyKey: string;            // dedup — a retry never double-sends (texting-1.6)
    }

    /** What an adapter returns from send() — already normalized to our shape (texting-6.6). */
    export interface AdapterSendResult { messageId?: string; segments?: number; rawCode?: string; ok: boolean; }

    /** A normalized inbound/DLR event after the adapter parsed its provider's dialect (texting-3.3). */
    export interface NormalizedEvent
    {
        kind:               "dlr" | "inbound";
        from:               Type.PhoneE164;
        to:                 Type.PhoneE164;   // our number — resolves account/contact (texting-7.3.2)
        providerMessageId?: string;
        status?:            DeliveryStatus;    // dlr
        providerCode?:      string;            // raw code retained for audit
        body?:              string;            // inbound
        receivedAt:         Type.ISODateTime;
    }

    /**
     * Every provider adapter implements this. The ONLY component that speaks provider dialect
     * (texting-16.2). Resolved via a typed registry by `Provider` — no `modules[name][cmd]`.
     */
    export interface SmsAdapter
    {
        readonly provider: Provider;
        send(req: OutboundRequest, creds: Type.Json): Promise<AdapterSendResult>;
        /** Parse this provider's DLR/status webhook → normalized (texting-3.3, the "UDF" half). */
        normalizeStatus(payload: Type.Json): NormalizedEvent;
        /** Parse this provider's inbound (MO) webhook → normalized. */
        normalizeInbound(payload: Type.Json): NormalizedEvent;
        /** Verify the provider's webhook signature before intake (texting-7.1). */
        verifySignature(headers: Type.Json, rawBody: string): boolean;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Message / send-log — one row per message, both directions (texting-11.1).
    //   pk=ACCOUNT#<accountId>  sk=MSG#<messageId>
    // ──────────────────────────────────────────────────────────────────────────

    export interface Message
    {
        accountId:      Type.ID;
        messageId:      Type.ID;
        direction:      Direction;
        type:           MessageType;
        contactId:      Type.ID;           // opaque — no PII in keys/logs
        from:           Type.PhoneE164;    // our number (outbound) / contact (inbound)
        to:             Type.PhoneE164;
        provider:       Provider;
        carrier?:       Carrier;
        campaignId?:    Type.ID;
        conversationId: Type.ID;           // → Conversation (texting-7.2)
        body?:          string;            // GDPR-forget obfuscates this + the to-number (texting-13.1)
        mediaKeys?:     Array<Type.ID>;    // → media service
        segments?:      number;            // billed units (texting-2.5 / 11.3)

        status:         DeliveryStatus;    // normalized (texting-3.3)
        providerCode?:  string;            // raw provider code — audit only
        errCode?:       ErrCode;           // normalized error category (texting-6.5)
        outcome?:       Outcome;           // gating outcome (texting-17.1)

        scheduleAt?:    Type.ISODateTime;  // scheduled / drip step
        sentAt?:        Type.ISODateTime;
        deliveredAt?:   Type.ISODateTime;
        createdAt:      Type.ISODateTime;
        idempotencyKey: string;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Conversation / thread — texting OWNS this store (texting-7.2). One per (account, contact).
    //   pk=ACCOUNT#<accountId>  sk=CONV#<conversationId>
    // FULL RETENTION — no TTL (texting-13.5); erasure only via contact-forget.
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The inbox status filter values (texting-7.5.1) — a blend of conversation lifecycle and the
     * last message's delivery outcome. These are QUERIED across typed fields, not parsed from a bag.
     */
    export enum InboxStatus
    {
        UNREAD           = "unread",
        CONTACT_REPLIED  = "contact_replied",
        TEXTER_RESPONDED = "texter_responded",
        TEXTER_MODIFIED  = "texter_modified",
        DELIVERED        = "delivered",
        UNDELIVERED      = "undelivered",
        DAILY_CAPPED     = "daily_capped",
        UNREACHABLE      = "unreachable",
        CARRIER_SKIP     = "carrier_skip",
        EXPIRED          = "expired",
    }

    export interface Conversation
    {
        accountId:      Type.ID;
        conversationId: Type.ID;
        contactId:      Type.ID;
        // the contact's "stuck" number — first send pins it; replies are PINNED here (texting-4.3.3)
        stickyNumber:   Type.PhoneE164;
        lifecycle:      Lifecycle;
        status:         InboxStatus;
        labels?:        Array<Label>;      // agent triage tags (texting-7.5.3)
        assignedTo?:    Type.ID;           // texter (texting-21.4) — undefined = shared pool
        campaignId?:    Type.ID;
        lastMessageAt:  Type.ISODateTime;
        unread:         boolean;
        createdAt:      Type.ISODateTime;
    }

    /**
     * The recorded `(account/campaign, contact) → number used` map (texting-4.3.1) — what makes
     * reply routing work across multiple numbers (area-code / multi-number / failover). Durable
     * (the send-log/conversation), since replies can arrive days later (NOT just a Redis cache).
     *   pk=ACCOUNT#<accountId>  sk=NUMMAP#<contactId>#<number>
     */
    export interface NumberUsage
    {
        accountId:  Type.ID;
        contactId:  Type.ID;
        number:     Type.PhoneE164;
        campaignId?: Type.ID;
        lastUsedAt: Type.ISODateTime;
        sticky:     boolean;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Templates & content (texting-2)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Template
    {
        accountId:  Type.ID;
        templateId: Type.ID;
        name:       string;
        body:       string;                // merge tags like @firstName@ (texting-2.2)
        mediaKeys?: Array<Type.ID>;        // MMS
        createdBy:  Type.ID;
        createdAt:  Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Opt-out / autoresponder (texting-5.3 / 7.7)
    // ──────────────────────────────────────────────────────────────────────────

    /** Per-campaign opt-out granularity — replaces the legacy splitdnd flag soup (texting-5.12). */
    export enum OptOutScope { GLOBAL = "global", NUMBER = "number", BRAND = "brand", CAMPAIGN = "campaign" }

    /**
     * A keyword autoresponder (texting-7.7). Compliance keywords (STOP/HELP/START) are matched FIRST
     * and authoritative (texting-7.7.1) — a custom autoresponder never fires on them.
     * Example: `{ keywords: ["INFO"], reply: "Hours: 9–5 M–F. Reply STOP to opt out." }`
     */
    export interface Autoresponder
    {
        autoresponderId: Type.ID;
        scope:      "account" | "campaign"; // campaign overrides/extends account (texting-7.7.2)
        scopeId:    Type.ID;
        keywords:   Array<string>;          // case-insensitive
        reply?:     string;                 // templated; runs canSend() like any send (texting-7.7.3)
        addLabels?: Array<Label>;           // may tag/route instead of (or with) replying (texting-7.7.5)
        enabled:    boolean;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Send-window reservation — the "tetris" capacity planner (texting-15).
    // Cross-account scheduler is owned by DISPATCH; this is the texting-side request/result.
    // ──────────────────────────────────────────────────────────────────────────

    /** Best-effort, NOT a hard SLA (texting-15.7). */
    export enum ReservationStatus { CONFIRMED = "confirmed", FLAGGED = "flagged" }

    export interface Reservation
    {
        reservationId: Type.ID;
        accountId:     Type.ID;
        campaignId:    Type.ID;
        windowStart:   Type.ISODateTime;
        windowEnd:     Type.ISODateTime;   // a SOFT target the age-monitor watches (texting-12.3)
        timezone:      Type.TimeZone;
        volume:        number;             // message count
        priority:      1 | 2 | 3 | 4 | 5;  // account priority — 5 = highest (texting-15.3)
        status:        ReservationStatus;
        note?:         string;             // over-subscription heads-up (texting-15.5)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ⚠️ Agent workflow — the product's heart (texting-21). Human texters at scale.
    // ──────────────────────────────────────────────────────────────────────────

    /** texting-21.1 */
    export enum SendMode { MANUAL = "manual", RAPID = "rapid", RESPONSE = "response" }

    /**
     * A batch of contacts checked out to a texter under a LOCK (texting-21.2) — the concurrency
     * primitive that stops two texters colliding on the same contact. Built on `WorkQueue` + Redis lock.
     *   pk=ACCOUNT#<accountId>  sk=CHECKOUT#<texterId>#<checkoutId>
     */
    export interface ContactCheckout
    {
        checkoutId: Type.ID;
        accountId:  Type.ID;
        campaignId: Type.ID;
        texterId:   Type.ID;
        contactIds: Array<Type.ID>;        // the locked batch
        lockedAt:   Type.ISODateTime;
        expiresAt:  Type.ISODateTime;      // TTL — unworked contacts requeue to the pool
        mode:       SendMode;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Events to analytics / realtime / integrations (texting-7.4 / 7.8 / 11.2)
    // ──────────────────────────────────────────────────────────────────────────

    /** The inbound fan-out event multiple subscribers consume (webhooks + marketplace) — texting-7.8. */
    export interface MessageReceivedEvent
    {
        accountId:      Type.ID;
        contactId:      Type.ID;
        conversationId: Type.ID;
        messageId:      Type.ID;
        from:           Type.PhoneE164;
        to:             Type.PhoneE164;
        body?:          string;
        receivedAt:     Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Stats — TYPED dimensions, not prefixed column names (texting-19.2, the lesson applied).
    //   pk=COUNTER#<scope>#<id>  sk=<period>#<dimsHash>
    // ──────────────────────────────────────────────────────────────────────────

    export enum CounterScope  { CAMPAIGN = "campaign", PROVIDER = "provider", ACCOUNT = "account" }
    export enum CounterPeriod { LIFETIME = "lifetime", DAY = "day", MONTH = "month" }

    /** The dimension tuple a counter is keyed by — queried by dimension directly (texting-19.2). */
    export interface CounterKey
    {
        scope:      CounterScope;
        id:         Type.ID;
        period:     CounterPeriod;
        bucket?:    string;        // e.g. "2026-06-13" (day) / "2026-06" (month)
        carrier?:   Carrier;
        tcr?:       boolean;
        broadcast?: boolean;
        errCode?:   ErrCode;
    }

    /** A counter row — `delivery% = 100 − (err / totalSent)` is derived from these (texting-19.4). */
    export interface Counter { key: CounterKey; totalSent: number; delivered: number; err: number; segments: number; }

    // ──────────────────────────────────────────────────────────────────────────
    // API payloads
    // ──────────────────────────────────────────────────────────────────────────

    /** Enqueue a send (S2S — POST /texting/send). Resolved to a number + provider at send (texting-1.1). */
    export interface SendRequest
    {
        accountId:      Type.ID;
        contactId:      Type.ID;
        campaignId?:    Type.ID;
        body?:          string;
        templateId?:    Type.ID;
        mediaKeys?:     Array<Type.ID>;
        scheduleAt?:    Type.ISODateTime;
        idempotencyKey: string;
    }

    /** Read of the account's numbers (GET /texting/numbers) — minAccess gate from the endpoint layer. */
    export interface NumbersQuery { accountId: Type.ID; minAccess: Access.AccountRole; }
}

export default Texting;
// eof
