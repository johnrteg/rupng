//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";
import { Account } from "../../account/model/Account";   // shared brand-identity type (BrandFont)

//
// Campaign — the shared **wire contract** for the campaign domain: the orchestration record an account
// uses to turn intent (message · audience · goal) into a governed, scheduled, measured send across one or
// more channels. Defined ONCE here so every campaign endpoint + the service + web import the same shapes.
//
// The hierarchy (see apps/core/campaign/SPECS.md):
//   Campaign ──selects 1..N──► Channel ──has 1──► Strategy   (per-channel cadence / goal / budget slice)
//                                       └─has 1..N─► Plan     (schedule-based send unit — "email Tuesday")
//
// Budget / approvals / audience / lifecycle stay CAMPAIGN-level; a Strategy declares a budget *slice*
// within the campaign cap, never its own authority. This is an INITIAL cut — approvals, A/B, runs, and the
// audience snapshot are modeled minimally (ids + status) and fleshed out as those subsystems land.
//
export namespace Campaign
{
    // ──────────────────────────────────────────────────────────────────────────
    // Enums
    // ──────────────────────────────────────────────────────────────────────────

    /** Lifecycle state machine (campaign SPECS "Lifecycle"). Every transition is RBAC-gated + audited. */
    export enum Status
    {
        DRAFT          = "draft",            // being authored
        IN_REVIEW      = "in_review",        // submitted for approval (content locked)
        APPROVED       = "approved",         // all required approvals in
        SCHEDULED      = "scheduled",        // has a send window
        SENDING        = "sending",          // a run is in flight
        PAUSED         = "paused",           // mid-send, halted
        SENT           = "sent",             // all recipients handed off
        PARTIALLY_SENT = "partially_sent",   // some recipients failed permanently
        CANCELED       = "canceled",         // stopped before completion
        FAILED         = "failed",           // errored out
        ARCHIVED       = "archived",         // terminal, read-only
    }

    /** A delivery medium the campaign can select. Each maps to a channel-owning service. */
    export enum Channel
    {
        EMAIL   = "email",
        TEXTING = "texting",
        PRINT   = "print",
        VOICE   = "voice",
        SOCIAL  = "social",
    }

    /** A channel strategy's cadence philosophy — how its plans relate over time. */
    export enum Cadence
    {
        BLAST = "blast",   // one big push
        DRIP  = "drip",    // spread over a sequence of plans
    }

    /** The metric a channel's strategy optimizes for (drives A/B winner selection later). */
    export enum SuccessMetric
    {
        DELIVERED   = "delivered",
        CLICKS      = "clicks",
        REPLIES     = "replies",
        CONVERSIONS = "conversions",
    }

    /** When a plan fires. `NOW` sends on launch; `SCHEDULED` at a fixed instant; `RECIPIENT_TZ` at a
     *  local-time-of-day per recipient (e.g. "10am local"). */
    export enum PlanSchedule
    {
        NOW          = "now",
        SCHEDULED    = "scheduled",
        RECIPIENT_TZ = "recipient_tz",
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Value objects — the Channel → Strategy → Plan hierarchy
    // ──────────────────────────────────────────────────────────────────────────

    /** A scheduled unit of work within a channel ("send an email Tuesday"). The smallest thing a run acts on;
     *  all of a channel's plans roll up to that channel's strategy. */
    export interface Plan
    {
        id:            Type.UUID;
        name:          string;
        schedule:      PlanSchedule;
        sendAt?:       Type.ISODateTime;   // when schedule = SCHEDULED
        localTime?:    string;             // "HH:mm" local time-of-day when schedule = RECIPIENT_TZ
        variantIds?:   Array<Type.UUID>;   // the content variant(s) this plan sends (empty = channel default)
        audienceSlice?: Type.UUID;         // optional sub-audience; defaults to the channel's audience
        enabled:       boolean;
    }

    /** The per-channel plan of attack — exactly one per channel. The "why/how"; plans are the "when". */
    export interface Strategy
    {
        cadence:          Cadence;
        successMetric?:   SuccessMetric;
        budgetSliceCents?: Type.Cents;     // this channel's slice WITHIN the campaign cap (whole cents) — never its own cap
        planOrder?:       Array<Type.UUID>; // explicit ordering of this channel's plans (else creation order)
        notes?:           string;
    }

    /** One selected channel on the campaign: its strategy + plans + sending identity. */
    export interface ChannelConfig
    {
        channel:      Channel;
        enabled:      boolean;
        strategy:     Strategy;
        plans:        Array<Plan>;
        fromAddress?: string;    // email from-address (incl. no-reply) — when channel = EMAIL
        numberId?:    Type.UUID; // registered outgoing number — when channel = TEXTING / VOICE
    }

    /** A reference to the campaign's audience — the segment query is frozen at schedule; recipients are
     *  materialized (contactIds only) when a run starts. Modeled minimally for the initial cut. */
    export interface AudienceRef
    {
        segmentId?:      Type.UUID;
        subFilters?:     Array<Type.UUID>;   // optional sub-segment filter ids
        holdoutPercent?: number;             // 0..100 control group held back for lift measurement
    }

    /** Campaign-level budget cap (the cross-channel cost authority). Two thresholds: soft alerts + hard stop. */
    export interface Budget
    {
        hardCapCents?:       Type.Cents;     // absolute limit — hard-stop on reach (whole cents)
        alertThresholdPcts?: Array<number>;  // soft alert thresholds, e.g. [ 80, 90 ]
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Campaign (the resource)
    //   DynamoDB: campaigns  PK: accountId  SK: campaignId   GSI status: (accountId, status)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:          Type.UUID;
        accountId:   Type.UUID;
        name:        string;
        objective?:  string;               // free-text goal (feeds AI message tailoring later)
        status:      Status;
        channels:    Array<ChannelConfig>; // the selected channels, each with its strategy + plans
        audience?:   AudienceRef;
        budget?:     Budget;
        palette?:    Array<string>;        // campaign color palette (ordered hex values) — content creation + image search
        fonts?:      Array<Account.BrandFont>;   // campaign brand fonts (public web-font references)
        svgs?:       Array<Account.BrandSvg>;    // campaign brand SVG graphics (inline markup, recolorable)
        ownerId:     Type.UUID;            // the creating user
        createdAt:   Type.ISODateTime;
        modifiedAt:  Type.ISODateTime;
    }

    /** Create payload — server assigns id / accountId / status / timestamps / ownerId. */
    export type CreateCampaign = Pick<Entity, "name"> & Partial<Pick<Entity, "objective" | "channels" | "audience" | "budget" | "palette" | "fonts" | "svgs">>;

    /** Update payload — any subset of the editable fields (locked once submitted). */
    export type UpdateCampaign = Partial<Pick<Entity, "name" | "objective" | "channels" | "audience" | "budget" | "palette" | "fonts" | "svgs">>;

    /**
     * Read-time DEFAULTs — the safe baseline for fields an older / partial `campaigns` row may be missing.
     * Apply with `ObjectUtils.withDefaults( row, Campaign.DEFAULT )` after a read. Identity / lifecycle fields
     * (`id`, `accountId`, `name`, `ownerId`, `createdAt`, `modifiedAt`) are OMITTED — a row missing those is an
     * anomaly to surface, not fabricate.
     */
    export const DEFAULT : Partial<Entity> =
    {
        status:   Status.DRAFT,
        channels: [],
    };

    // ── Schema + validator for the API record `Entity` (wire + messaging shape) ──────────────────
    const PLAN_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "id", "name", "schedule", "enabled" ],
        properties:
        {
            id:            { type: "string" },
            name:          { type: "string" },
            schedule:      { type: "string", enum: Object.values( PlanSchedule ) },
            sendAt:        { type: "string" },   // date-time — formatless (loose wire validation)
            localTime:     { type: "string" },
            variantIds:    { type: "array", items: { type: "string" } },
            audienceSlice: { type: "string" },
            enabled:       { type: "boolean" },
        },
    };

    const STRATEGY_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "cadence" ],
        properties:
        {
            cadence:          { type: "string", enum: Object.values( Cadence ) },
            successMetric:    { type: "string", enum: Object.values( SuccessMetric ) },
            budgetSliceCents: { type: "number" },
            planOrder:        { type: "array", items: { type: "string" } },
            notes:            { type: "string" },
        },
    };

    const CHANNEL_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "channel", "enabled", "strategy", "plans" ],
        properties:
        {
            channel:     { type: "string", enum: Object.values( Channel ) },
            enabled:     { type: "boolean" },
            strategy:    STRATEGY_SCHEMA,
            plans:       { type: "array", items: PLAN_SCHEMA },
            fromAddress: { type: "string" },
            numberId:    { type: "string" },
        },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "name", "status", "channels", "ownerId", "createdAt", "modifiedAt" ],
        properties:
        {
            id:         { type: "string", format: "uuid" },
            accountId:  { type: "string", format: "uuid" },
            name:       { type: "string" },
            objective:  { type: "string" },
            status:     { type: "string", enum: Object.values( Status ) },
            channels:   { type: "array", items: CHANNEL_SCHEMA },
            audience:
            {
                type: "object", additionalProperties: false,
                properties:
                {
                    segmentId:      { type: "string" },
                    subFilters:     { type: "array", items: { type: "string" } },
                    holdoutPercent: { type: "number" },
                },
            },
            budget:
            {
                type: "object", additionalProperties: false,
                properties:
                {
                    hardCapCents:       { type: "number" },
                    alertThresholdPcts: { type: "array", items: { type: "number" } },
                },
            },
            palette:    { type: "array", items: { type: "string" } },   // ordered campaign hex values
            fonts:      { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "name", "href" ],
                properties: { name: { type: "string" }, href: { type: "string" } },
            } },
            svgs:       { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "name", "svg" ],
                properties: { name: { type: "string" }, svg: { type: "string" } },
            } },
            ownerId:    { type: "string", format: "uuid" },
            createdAt:  { type: "string", format: "date-time" },
            modifiedAt: { type: "string", format: "date-time" },
        },
    };

    /** Validate a `Campaign.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Campaign;
// eof
