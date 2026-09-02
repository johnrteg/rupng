//
// Analytics domain model — the business / engagement plane.
//
// Everything is scoped under the `Analytics` namespace:
//   Analytics.Event        (the canonical, immutable engagement fact — every channel emits this shape)
//   Analytics.BehaviorEvent(in-app product/behavior fact — second event family, same lake, different shape)
//   Analytics.Rollup       (precomputed aggregate — what dashboards read, NOT raw scans)
//   Analytics.Attribution* (which touch earns the conversion — computed over the cross-channel history)
//
// Scalars come from `Type` in @repo/common (ID, ISODateTime, Json); the role ladder from
// `Access` in @repo/endpoint.
//
// ── The ONE rule (gap #1 / #11, analytics-3.4 / 8.3) ────────────────────────────────────────────
//   NO PII EVER LANDS HERE. Events carry an OPAQUE `contactId` (resolved upstream by contact),
//   never a raw phone/email; `attrs` and behavior `props` carry OPAQUE ids only; a `clicked`
//   event stores a link UUID, never a PII-bearing destination URL. This is what makes an
//   append-only lake GDPR-survivable — a "forget" tombstones the contact upstream and the lake's
//   rows become unlinkable to a person WITHOUT mutating immutable Parquet.
//
// Storage (see SPECS.md "Architecture"):
//   Event / BehaviorEvent → Kafka (single backbone) → Kafka→S3 sink → append-only S3 lake
//                           (raw → curated Parquet, partitioned `account/channel/date`), queried by Athena.
//   Rollup                → curated tables + hot store (Redis / OpenSearch) for live dashboards.
//   Ingestion is at-least-once; dedup on a stable event id at every stage (gap #7).
//

import type { Type } from "@repo/common";
import { Access }    from "@repo/endpoint";   // value import — AccountRole enum is used at runtime

export namespace Analytics
{
    // ──────────────────────────────────────────────────────────────────────────
    // Dimensions — channel, provider, event-type taxonomy
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The channel a message-event belongs to. Cross-channel by design — a `clicked` from links
     * or a print QR scan lands here alongside SMS/email. Extensible: adding a channel is a
     * backward-compatible schema change (analytics-8.2), so the `(string & {})` keeps unknown
     * future channels assignable without widening to a bare `string`.
     */
    export type Channel =
        | "sms" | "mms" | "email" | "push" | "whatsapp" | "rcs" | "voice" | "print" | "social"
        | (string & {});

    /**
     * The downstream provider/vendor that produced the event. Known values are documented; the
     * `(string & {})` admits new providers without a type change. NOTE: providers are normalized
     * UPSTREAM by the channel service — analytics never parses a raw provider webhook.
     */
    export type Provider =
        | "twilio" | "bandwidth" | "telnyx"          // sms/voice
        | "ses" | "mailgun" | "sendgrid" | "postmark" | "sparkpost"  // email
        | "fcm" | "apns"                              // push
        | (string & {});

    /**
     * The normalized event verb (one taxonomy across all providers). `converted` and custom goal
     * events use a `string` escape hatch (e.g. "goal:newsletter_signup") — see Conversion.
     */
    export enum EventType
    {
        // Outbound lifecycle
        QUEUED          = "queued",
        SENT            = "sent",
        DELIVERED       = "delivered",
        DELIVERY_FAILED = "delivery_failed",
        BOUNCED         = "bounced",          // + attrs.bounceType: hard|soft
        REJECTED        = "rejected",
        // Engagement
        OPENED          = "opened",           // email open
        CLICKED         = "clicked",          // link click (from links/tracking) — strongest intent signal
        REPLIED         = "replied",          // inbound reply
        // Negative / compliance (these ALSO take the operational suppression path upstream — see SPECS)
        OPTED_OUT       = "opted_out",
        UNSUBSCRIBED    = "unsubscribed",
        COMPLAINED      = "complained",       // spam report
        // Conversion
        CONVERTED       = "converted",        // a goal — see Conversion + attribution
    }

    /** Any normalized verb, or a custom goal string (`goal:*`). Keeps custom events first-class. */
    export type EventVerb = EventType | (string & {});

    export type BounceType = "hard" | "soft";

    // ──────────────────────────────────────────────────────────────────────────
    // attrs — the channel-specific bag (versioned contract; NO PII, ever)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Channel-specific attributes. The common fields are typed; anything else rides the index
     * signature (a versioned `attrs` contract lives in the Glue Catalog — analytics-8.1). Hard rule:
     * OPAQUE ids only — `linkId` (a UUID), never a destination URL; `userAgent` is fine, the raw
     * query string is NOT (search → length + result count). Enforced (analytics-8.3).
     */
    export interface EventAttrs
    {
        bounceType?:  BounceType;        // for `bounced`
        linkId?:      Type.ID;           // for `clicked` — resolve the URL via the links service (NO raw URL)
        userAgent?:   string;            // device/browser string (no PII)
        geo?:         string;            // coarse region (e.g. "US-CA") — never precise lat/long
        segments?:    Array<string>;     // audience segment ids/labels this send belonged to
        failureCode?: string;            // normalized provider failure class (not the raw provider blob)
        [key: string]: Type.Json | undefined;  // versioned extension point — opaque values only
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Event — the canonical engagement fact (immutable; the heart of the lake)
    //   Lake partition: account/channel/date(occurredAt).  Dedup: (provider, providerEventId).
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * One normalized, immutable engagement fact. Sample (jsonc):
     *   {
     *     "eventId":         "9b1f…",                 // our id (idempotency)
     *     "occurredAt":      "2026-06-15T17:04:21Z",  // PROVIDER event time — ordering key (gap #12)
     *     "ingestedAt":      "2026-06-15T17:04:25Z",
     *     "accountId":       "acct_123",
     *     "campaignId":      "camp_888",              // null for transactional / non-campaign
     *     "messageId":       "msg_456",
     *     "contactId":       "ctc_789",               // OPAQUE — never a raw phone/email
     *     "channel":         "email",
     *     "provider":        "ses",
     *     "eventType":       "clicked",
     *     "providerEventId": "ses-evt-0001",          // for dedup
     *     "variant":         "B",                     // A/B variant (attribution)
     *     "attrs":           { "linkId": "lnk_42" }
     *   }
     */
    export interface Event
    {
        eventId:         Type.ID;            // our id — idempotency / dedup of internally generated events
        occurredAt:      Type.ISODateTime;   // PROVIDER event time (NOT ingest time) — the ordering key
        ingestedAt:      Type.ISODateTime;   // when we received it
        accountId:       Type.ID;            // partition + tenant isolation
        campaignId:      Type.ID | null;     // null = transactional / non-campaign
        messageId:       Type.ID;            // our send id
        contactId:       Type.ID | null;     // OPAQUE; null when the sender is unknown (see anonId, gap #6)
        anonId?:         string;             // salted hash of the normalized value when contactId is unknown
        channel:         Channel;
        provider:        Provider;
        eventType:       EventVerb;
        providerEventId: string;             // provider's id — half of the dedup key
        variant?:        string;             // A/B variant, for attribution
        attrs?:          EventAttrs;         // channel-specific (NO PII)
    }

    /**
     * The idempotency key — `(provider, providerEventId)`, NOT providerEventId alone (not globally
     * unique across providers). Internally generated events (e.g. behavior) instead dedup on their
     * producer-assigned `eventId`. (analytics-1.3, gap #7)
     */
    export interface DedupKey { provider: Provider; providerEventId: string; }

    // ──────────────────────────────────────────────────────────────────────────
    // BehaviorEvent — in-app product analytics (second family; same lake, own shape)
    //   Intake: web app track() → app BFF /app/events → Kafka → analytics. (analytics-2.x)
    // ──────────────────────────────────────────────────────────────────────────

    /** Device facts (mapped from @repo/common UserAgent upstream). No PII. */
    export interface Device { os?: string; osVersion?: string; browser?: string; browserVersion?: string; formFactor?: "desktop" | "tablet" | "mobile"; }

    /**
     * One first-party in-app behavior fact (navigation / feature usage / intent / friction).
     * `client = intent, server = outcome`: the client fires intent (`send.clicked`); the OUTCOME
     * (`campaign.sent`) arrives as a Kafka domain event. Analytics joins the two on
     * accountId / userId / sessionId / transactionId (analytics-2.4). Sample (jsonc):
     *   {
     *     "eventId":       "uuid",                  // producer-assigned (dedupable like provider events)
     *     "occurredAt":    "2026-06-15T17:04:21Z",  // client time (UTC)
     *     "accountId":     "acct_123",              // identity-joined (first-party advantage over GA)
     *     "userId":        "usr_55",
     *     "sessionId":     "sess_af2",
     *     "event":         "report.create.clicked", // object.action — domain-meaningful
     *     "route":         "/campaigns/123",
     *     "transactionId": "txn_77",                // correlates to RUM + backend traces
     *     "props":         { "resultCount": 12 }    // OPAQUE only — never the raw search query
     *   }
     */
    export interface BehaviorEvent
    {
        eventId:        Type.ID;
        occurredAt:     Type.ISODateTime;    // client time (UTC)
        accountId:      Type.ID;
        userId:         Type.ID;
        sessionId:      string;
        event:          string;              // `object.action` — e.g. "report.create.clicked"
        route?:         string;
        fromRoute?:     string;
        transactionId?: Type.ID;             // joins to RUM + backend traces
        appVersion?:    string;
        device?:        Device;
        props?:         { [key: string]: Type.Json };  // event-specific — OPAQUE ids only, NEVER PII
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Rollups & the hot store — what dashboards read (analytics-4.x)
    // ──────────────────────────────────────────────────────────────────────────

    export type Granularity = "hour" | "day" | "week" | "month";

    /** The dimensions a rollup is bucketed by. A null/absent dimension = "all" for that axis.
     *  `provider` feeds deliverability (analytics-7.4 — bounce/complaint/failure BY PROVIDER); it's
     *  absent for behavior-event rollups (analytics-2.x has no provider concept). */
    export interface RollupDimensions
    {
        accountId:  Type.ID;
        channel?:   Channel;
        campaignId?: Type.ID;
        variant?:   string;
        eventType?: EventVerb;
        provider?:  Provider;
    }

    /**
     * A precomputed aggregate for one dimension-combination + period. Recomputable from raw (gap #8);
     * writes are idempotent on `(dimensions + period)` so a recompute can't double-apply (gap #7).
     */
    export interface Rollup
    {
        dimensions:   RollupDimensions;
        granularity:  Granularity;
        periodStart:  Type.ISODateTime;   // bucket start (UTC)
        count:        number;             // events in this bucket (deduped on eventId before COUNT)
        closed:       boolean;            // false while inside the grace window; a late straggler reopens → recompute
        computedAt:   Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attribution — which touch earns the conversion (analytics-6.x)
    //   Lives HERE because it's a computation over the cross-channel history (touches + conversion).
    // ──────────────────────────────────────────────────────────────────────────

    /** Attribution model (one is the account default). `DATA_DRIVEN` is deferred (needs volume + ML). */
    export enum AttributionModel
    {
        LAST_TOUCH     = "last_touch",      // default — 100% to the last touch before conversion
        FIRST_TOUCH    = "first_touch",     // 100% to the first touch (acquisition source)
        LINEAR         = "linear",          // split evenly across all touches
        TIME_DECAY     = "time_decay",      // more credit nearer the conversion
        POSITION_BASED = "position_based",  // U-shaped — weighted to first + last
        DATA_DRIVEN    = "data_driven",     // model-learned weights (later)
    }

    /**
     * Separate click-through and view-through windows (days). A conversion outside ANY touch's
     * window is organic (unattributed) — don't over-credit. Default 7d / 1d (analytics-6.2).
     */
    export interface LookbackWindow { clickThroughDays: number; viewThroughDays: number; }

    /** Per-account/campaign attribution settings. Stored WITH each result for reproducibility (gap analytics-6.4). */
    export interface AttributionConfig
    {
        accountId:   Type.ID;
        campaignId?: Type.ID;              // absent = account default
        model:       AttributionModel;
        window:      LookbackWindow;
    }

    /**
     * A trackable channel event tied to a contact + campaign/variant (a delivered message, an open,
     * a click). The unit of credit. Only KNOWN contactIds can be 1:1 attributed — an anonId can't
     * (same rule as anonymous social posts → credited at campaign/audience level, gap #6).
     */
    export interface Touch
    {
        eventId:    Type.ID;               // → the source Event
        contactId:  Type.ID;
        campaignId: Type.ID;
        channel:    Channel;
        variant?:   string;
        type:       Extract<EventVerb, string> | EventType;  // delivered | opened | clicked
        occurredAt: Type.ISODateTime;
    }

    /** Where a conversion came from. v1 = integration commerce/goal event; others behind the same contract (gap #3). */
    export type ConversionSource = "integration" | "postback" | "pixel" | "manual";

    /**
     * A goal event tied to a contactId (a Shopify order, a donation, a booking, a closed deal).
     * Primarily an integration's commerce/goal event (marketplace → workflow → analytics).
     */
    export interface Conversion
    {
        eventId:    Type.ID;
        accountId:  Type.ID;
        contactId:  Type.ID;
        goal:       string;                // e.g. "order.placed" | "donation" | "goal:newsletter_signup"
        source:     ConversionSource;
        value?:     number;                // monetary value, if any
        currency?:  string;                // ISO-4217 (e.g. "USD"), when value is set
        occurredAt: Type.ISODateTime;
    }

    /** A single touch's share of one conversion (0..1). Touches credited sum to ≤ 1 (≤ when organic). */
    export interface Credit { touchEventId: Type.ID; channel: Channel; campaignId: Type.ID; weight: number; }

    /**
     * The computed attribution for one conversion. Stamped with the `model` + `window` used so a
     * later report run reproduces what was reported then (analytics-6.4). `organic = true` when the
     * conversion fell outside every touch's window (no credit assigned).
     */
    export interface AttributionResult
    {
        conversionEventId: Type.ID;
        accountId:         Type.ID;
        contactId:         Type.ID;
        model:             AttributionModel;   // snapshot of the rule used
        window:            LookbackWindow;     // snapshot of the windows used
        credits:           Array<Credit>;      // empty when organic
        organic:           boolean;
        computedAt:        Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Query API payloads (analytics-5 / 7) — the RBAC-scoped read surface
    //   report / campaign / web read THIS, never the lake directly. Live → hot store; historical → Athena.
    // ──────────────────────────────────────────────────────────────────────────

    /** Common filter for the read endpoints. RBAC + tenancy are applied server-side on top of this. */
    export interface QueryFilter
    {
        accountId:    Type.ID;             // staff may span accounts; an account is pinned to its own
        from:         Type.ISODateTime;
        to:           Type.ISODateTime;
        channel?:     Channel;
        campaignId?:  Type.ID;
        eventType?:   EventVerb;
        granularity?: Granularity;
    }

    /** The standard read envelope (mirrors the platform `{ data, page }` shape). */
    export interface Page { cursor?: string; nextCursor?: string; limit: number; }
    export interface Result<T> { data: Array<T>; page?: Page; }

    /** A metrics row — count for one bucket of the requested dimensions. */
    export interface MetricRow { periodStart: Type.ISODateTime; dimensions: RollupDimensions; count: number; }

    /** One stage of a funnel (sent → delivered → opened → clicked → converted). `rate` = stage/previous. */
    export interface FunnelStage { stage: EventVerb; count: number; rate: number; }
    export interface Funnel { campaignId?: Type.ID; variant?: string; stages: Array<FunnelStage>; }

    /** Deliverability slice (feeds dispatch provider fail-over — analytics-7.4). */
    export interface Deliverability
    {
        provider:    Provider;
        channel:     Channel;
        domain?:     string;               // for email
        sent:        number;
        delivered:   number;
        bounced:     number;
        complained:  number;
        failed:      number;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Governance / lifecycle commands
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The analytics slice of the platform forget fan-out (analytics-8 / AnalyticsForgetJob).
     * Obfuscates PII in the lake + drops from the hot store. Because the lake is append-only and
     * PII-free by rule, a contact-forget is usually a no-op on raw rows (the contact tombstone
     * upstream is what makes them unlinkable) — account deletion is the heavier purge.
     */
    export interface ForgetCommand
    {
        scope:      "contact" | "account";
        accountId:  Type.ID;
        contactId?: Type.ID;               // required when scope = "contact"
        requestedAt: Type.ISODateTime;
    }

    /** Minimum access to read the query API (tenant isolation + RBAC layered on top). */
    export const QUERY_MIN_ACCESS: Access.AccountRole = Access.AccountRole.USER;
}

export default Analytics;
// eof
