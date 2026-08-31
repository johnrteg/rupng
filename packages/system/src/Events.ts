//
// Centralized platform EVENT VOCABULARY + per-event ACCESS — the shared, contextual events every
// service emits and that fan out to MANY sinks from ONE definition: Kafka (change-notification +
// streaming), realtime (WebSocket push), workflow (triggers), outbound webhooks, the audit trail,
// change-history, monitor. One event, many consumers.
//
// The floor a consumer must hold to RECEIVE / subscribe / trigger / read it. That needs `Access`, which
// lives here. So this is the single place that answers BOTH "what events exist" and "who may consume each".
//
// ── Why per-event minAccess (the consume floor) ─────────────────────────────────────────────────
//   An endpoint's `minAccess` gates who may PERFORM an action. This `minAccess` gates who may be
//   NOTIFIED of it: realtime won't push an event to a web client below the floor; workflow won't let
//   an account build a trigger on data it can't see; outbound webhooks are gated the same way; audit
//   reads are RBAC-scoped. Fail-closed: an unregistered verb defaults to ROOT (see `metaOf`).
//
// ── PII-LIGHT BY DESIGN ─────────────────────────────────────────────────────────────────────────
//   Because the SAME event lands in the immutable audit trail, the envelope is PII-light: `target`
//   is an id (never a value); `context` is ids / enums / counts (never field values or message
//   content). Sinks needing richer payloads wrap/extend this — they never widen the envelope.
//

import type { Type } from "@repo/common";
import Access        from "./Access";   // role ladders + isAllowed — events carry a minAccess floor
import type * as Payloads from "./payloads";   // the central entity-representation repository (Object → payload)

export namespace Events
{
    // ──────────────────────────────────────────────────────────────────────────
    // Categorization + routing
    //   (the emitting service — the FIRST segment of an `Action` — is `Register.Service`, see ./Register.ts)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The sinks an event can fan out to. An emit-time hint only — actual routing is config-driven
     * (all events → audit; a subset → realtime; account-chosen → workflow / webhooks).
     */
    export enum Sink
    {
        AUDIT          = "audit",          // the immutable action-level trail
        KAFKA          = "kafka",          // change-notification + streaming backbone
        REALTIME       = "realtime",       // WebSocket push to clients (filtered by minAccess)
        WORKFLOW       = "workflow",       // automation triggers (gated by minAccess)
        WEBHOOK        = "webhook",        // outbound webhooks (gated by minAccess)
        CHANGE_HISTORY = "change_history", // co-located field-level diffs (owning service)
        MONITOR        = "monitor",        // ops telemetry (peer)
    }

    /** Grouping for pick-list UIs (workflow trigger picker, webhook subscription, etc.). */
    export enum Category
    {
        SECURITY    = "security",     // auth, sessions, keys, impersonation
        ACCOUNT     = "account",      // account lifecycle, block list
        BILLING     = "billing",      // plan, invoice
        CONTACT     = "contact",      // contacts, consent, segments
        MESSAGING   = "messaging",    // sends, suppression, numbers, campaigns
        CONTENT     = "content",      // templates, media, links, docs, surveys
        INTEGRATION = "integration",  // marketplace, oauth, zapier
        AUTOMATION  = "automation",   // workflows, triggers, instances
        COMPLIANCE  = "compliance",   // forget, export, legal hold
        OPS         = "ops",          // alarms, platform config
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Actor / Target / Source / Outcome — the shared "who / what / where / result"
    // ──────────────────────────────────────────────────────────────────────────

    export enum ActorKind     { USER = "user", SERVICE = "service" }
    export enum SourceChannel { UI = "ui", API = "api", JOB = "job", WEBHOOK = "webhook" }
    export enum Outcome       { SUCCESS = "success", FAILURE = "failure", DENIED = "denied" }

    /**
     * Who performed the action. `id` is a `userId` / `serviceId` — never a name/email. Impersonation +
     * delegation are first-class: `realActorId` is the TRUE actor (e.g. staff) and `onBehalfOfId` the
     * subject acted for — how `staff.impersonate` / `data.access` stay accountable.
     */
    export interface Actor
    {
        kind:          ActorKind;
        id:            Type.ID;
        accountId?:    Type.ID;
        realActorId?:  Type.ID;
        onBehalfOfId?: Type.ID;
    }

    /** The object acted on — `{ type, id }`, BY ID ONLY (e.g. `{type:"contact", id:"ctc_789"}`). Never a value. */
    export interface Target { type: string; id: Type.ID; }

    /** Where the action originated. `ip`/`userAgent` only where relevant; not PII about the target. */
    export interface Source
    {
        channel         : SourceChannel;
        ip?             : string;
        userAgent?      : string;
        transactionId?  : Type.ID;
    }

    /** PII-light context — ids + enums + counts ONLY (primitives / arrays of primitives). NEVER values. */
    export type Context = { [key: string]: Type.JsonPrimitive | Array<Type.JsonPrimitive> };

    // ──────────────────────────────────────────────────────────────────────────
    // Verb — the canonical lifecycle vocabulary, CONSISTENT across every noun
    //   `deleted` = soft / recoverable (archive · close · disconnect · release); `purged` = permanent
    //   erasure (GDPR forget · hard delete). Success / failure / denied is the `outcome`, not a verb.
    // ──────────────────────────────────────────────────────────────────────────

    export enum Verb
    {
        CREATED  = "created",
        UPDATED  = "updated",
        DELETED  = "deleted",   // soft / recoverable
        PURGED   = "purged",    // permanent erasure (GDPR forget / hard delete)
        ACCESSED = "accessed",  // a READ/access event (not a lifecycle change) — e.g. staff viewing tenant data
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Object — the ENTITY/NOUN an event is about: `<service>.<noun>` (the prefix of an `Action`).
    //   THIS is the Kafka topic + the pub/sub manifest binding: one topic per Object, owned by the
    //   publishing service, keyed by entity id. A subscriber subscribes to the Objects it cares about
    //   (Kafka filters by TOPIC) and switches on the `verb` within. An `Action` = `${Object}.${Verb}`.
    //   (See root SPECS → "Events & messaging".)
    // ──────────────────────────────────────────────────────────────────────────

    export enum Object
    {
        // auth / identity
        AUTH_SESSION          = "auth.session",
        AUTH_MFA_CHALLENGE    = "auth.mfa_challenge",
        AUTH_ROLE_ASSIGNMENT  = "auth.role_assignment",
        AUTH_PERMISSION       = "auth.permission",
        AUTH_APIKEY           = "auth.apikey",
        AUTH_IMPERSONATION    = "auth.impersonation",
        AUTH_DATA             = "auth.data",
        AUTH_USER             = "auth.user",      // identity lifecycle (registered / updated / deleted)
        AUTH_PASSKEY          = "auth.passkey",   // WebAuthn credential lifecycle (registered / removed)

        // account
        ACCOUNT_ACCOUNT          = "account.account",
        ACCOUNT_MEMBER           = "account.member",   // membership lifecycle (joined / role-or-status change / removed)
        ACCOUNT_INVITE           = "account.invite",   // invite lifecycle (invited / resent / cancelled)
        ACCOUNT_PLAN             = "account.plan",
        ACCOUNT_INVOICE          = "account.invoice",
        ACCOUNT_BLOCK_LIST_ENTRY = "account.block_list_entry",

        // contact
        CONTACT_CONTACT   = "contact.contact",
        CONTACT_CONSENT   = "contact.consent",
        CONTACT_FIELD_DEF = "contact.field_def",
        CONTACT_SEGMENT   = "contact.segment",
        CONTACT_EXPORT    = "contact.export",

        // campaign / orchestration
        CAMPAIGN_CAMPAIGN = "campaign.campaign",
        WORKFLOW_WORKFLOW = "workflow.workflow",
        WORKFLOW_INSTANCE = "workflow.instance",

        // channels
        TEXTING_SUPPRESSION = "texting.suppression",
        
        EMAIL_TEMPLATE      = "email.template",
        EMAIL_SUPPRESSION   = "email.suppression",
        EMAIL_DOMAIN        = "email.domain",

        VOICE_CALL          = "voice.call",
        VOICE_SUPPRESSION   = "voice.suppression",
        VOICE_IVR_FLOW      = "voice.ivr_flow",

        PRINT_MAILPIECE     = "print.mailpiece",
        PRINT_SUPPRESSION   = "print.suppression",
        PRINT_TEMPLATE      = "print.template",

        SOCIAL_POST         = "social.post",
        SOCIAL_ACCOUNT      = "social.account",
        SURVEY_SURVEY       = "survey.survey",

        // registration / marketplace
        REGISTRATION_NUMBER        = "registration.number",
        MARKETPLACE_INTEGRATION    = "marketplace.integration",
        MARKETPLACE_OAUTH_TOKEN    = "marketplace.oauth_token",
        MARKETPLACE_ZAPIER_ACTION  = "marketplace.zapier_action",

        // assets
        MEDIA_ASSET  = "media.asset",
        MEDIA_JOB    = "media.job",   // async processing progress (stage events for UI + workflows, media-19.2)

        // links
        LINKS_LINK   = "links.link",
        LINKS_DOMAIN = "links.domain",

        // collaboration
        COLLAB_ROOM     = "collab.room",
        COLLAB_DOCUMENT = "collab.document",

        // insight / ops
        REPORT_REPORT                = "report.report",
        REPORT_SCHEDULE              = "report.schedule",
        MONITOR_ALARM                = "monitor.alarm",
        AUDIT_LEGAL_HOLD             = "audit.legal_hold",
        AUDIT_EXPORT                 = "audit.export",
        ANALYTICS_ATTRIBUTION_CONFIG = "analytics.attribution_config",

        // cross-cutting
        PLATFORM_CONFIG       = "platform.config",
        PLATFORM_FEATURE_FLAG = "platform.feature_flag",
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Stream — analytics ingestion streams: high-volume, broad, the analytics service is the SOLE
    //   consumer (the one place a "firehose" subscription is correct). NOT per-entity state-change.
    // ──────────────────────────────────────────────────────────────────────────

    export enum Stream
    {
        BEHAVIOR   = "platform.behavior",     // in-app product / behavior (app BFF /app/events → analytics)
        ENGAGEMENT = "platform.engagement",   // channel engagement (sent / delivered / opened / … → analytics)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Job stage — the progress lifecycle of an async processing Job (media-19.2). Emitted on the `media.job`
    //   Object (verb UPDATED) so the UI can show live progress and workflows can sequence steps.
    // ──────────────────────────────────────────────────────────────────────────

    export enum JobStage
    {
        QUEUED    = "queued",      // enqueued, not yet picked up
        STARTED   = "started",     // a worker began
        RUNNING   = "running",     // in progress (see `progress`)
        COMPLETED = "completed",   // succeeded — result written to the entity
        FAILED    = "failed",      // errored (see `message`)
    }

    /** The `data` of a `media.job` event — an async operation's progress on one entity (keyed by `guid`). */
    export interface JobProgress
    {
        guid      : string;        // the asset/entity the job is processing
        job       : string;        // the operation (e.g. "transcribe", "generate", "process")
        stage     : JobStage;
        progress? : number;        // 0..100 when known (RUNNING)
        message?  : string;        // human note / failure reason
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Action — the full event type, `${Object}.${Verb}` (e.g. "account.account.created"). DERIVED from
    //   the `Object` + `Verb` enums (the single source of truth) — NOT a hand-maintained list, so there's
    //   nothing to keep in sync. Materialized on the envelope so a sink filters by action / object / verb
    //   independently; the access catalog (`ACCESS`, below) keys per-verb floors off it. Compose with
    //   `actionOf(object, verb)`; split with `objectOf` / `verbOf`.
    // ──────────────────────────────────────────────────────────────────────────

    export type Action = `${Object}.${Verb}`;

    // ──────────────────────────────────────────────────────────────────────────
    // Envelope — the ONE contextual event shape every sink receives
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The shared contextual event. Sample (jsonc):
     *   {
     *     "eventId":   "9b1f…",                       // producer-assigned — idempotency / dedupe at every sink
     *     "occurredAt":"2026-06-16T17:04:21Z",        // when it happened (server time)
     *     "accountId": "acct_123",                    // tenant scope (partition / fan-out key)
     *     "actor":     { "kind":"user", "id":"usr_55", "accountId":"acct_123" },
     *     "action":    "contact.export.created",
     *     "target":    { "type":"contact_segment", "id":"seg_9" },   // BY ID ONLY
     *     "source":    { "channel":"ui" },
     *     "outcome":   "success",
     *     "context":   { "count": 1200 }              // PII-light — ids/enums/counts only
     *   }
     */
    export interface Envelope
    {
        version:    string;       // payload SCHEMA version (the owning service bumps it as `data` evolves)
        eventId:    Type.ID;       // unique per occurrence — idempotency / dedup at every sink
        occurredAt: Type.ISODateTime;
        accountId:  Type.ID;
        actor:      Actor;
        object:     Object;       // WHAT it's about (== the topic) — `<service>.<noun>`
        verb:       Verb;         // HOW it changed — created / updated / deleted / purged
        action:     Action;       // `${object}.${verb}` materialized on the wire, so a sink can filter on the
                                  // full action OR on object alone OR verb alone (see actionOf/objectOf/verbOf)
        target:     Target;
        source:     Source;
        outcome:    Outcome;
        context?:   Context;
        data?:      unknown;      // the entity's representation — FAT, typed per Object (see `Of<O>` / PayloadFor).
                                  // Optional on the base type so PII-light sinks (audit) handle any event; a
                                  // typed producer/consumer uses `Events.Of<Object.X>` where `data` is required.
        sinks?:     Array<Sink>;   // optional explicit routing hint (else config decides)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Payload — each Object's representation: its event `data` AND its API GET response (one shape, no
    //   drift). The representations live in the central repository `./payloads/<service>.ts`; `EventPayload`
    //   maps each Object → its type (many Objects may share one). `PayloadFor<O>` is that type (or `unknown`
    //   if unregistered); `Of<O>` is the envelope narrowed to one Object with a REQUIRED typed `data`.
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The central **Object → representation** registry. Each entry points an `Object` at its payload type
     * from the [`./payloads`](./payloads) repository — the SAME type the service's API `GET` returns, so the
     * event `data` and the GET response can't drift. Several Objects may map to one payload. Add an entry
     * when a service defines its entity.
     */
    export interface EventPayload
    {
        [Object.MEDIA_ASSET]:    Payloads.MediaAsset;
        [Object.MEDIA_JOB]:      JobProgress;   // async processing progress (media-19.2)
        [Object.SOCIAL_ACCOUNT]: Payloads.SocialAccount;
        [Object.SOCIAL_POST]:    Payloads.SocialPost;
        [Object.MARKETPLACE_INTEGRATION]: Payloads.MarketplaceIntegration;
        // … one per published entity (e.g. [Object.CONTACT_CONTACT]: Payloads.Contact) as services land.
    }

    /** The representation for an Object — its registered payload type, or `unknown` until registered. */
    export type PayloadFor<O extends Object> = O extends keyof EventPayload ? EventPayload[O] : unknown;

    /** The envelope narrowed to ONE Object, with a required, typed `data`. Use for typed pub/sub. */
    export interface Of<O extends Object> extends Envelope
    {
        object: O;
        data:   PayloadFor<O>;
    }

    // -- action <-> object/verb derivation (one string, three ways to read it) -----------------------

    /** Compose the full action string from an object + verb: `${object}.${verb}`. */
    export function actionOf( object : Object, verb : Verb ) : Action
    {
        return `${object}.${verb}` as Action;
    }

    /** The compact input to {@link envelope} — the per-event bits; the rest is stamped with sane defaults. */
    export interface EnvelopeInput
    {
        object:     Object;
        verb:       Verb;
        accountId:  Type.ID;
        target:     Target;
        data?:      unknown;
        actorUserId?: Type.ID;          // present → a USER actor; absent → the SERVICE actor (derived from the object's service prefix)
        source?:    SourceChannel;      // default API
        outcome?:   Outcome;            // default SUCCESS
        version?:   string;             // payload schema version (default "1")
    }

    /**
     * Build a complete {@link Envelope} from the per-event essentials — the ONE place the boilerplate
     * (eventId, occurredAt, action, actor default, KAFKA sink) is stamped, so every service emits an
     * identical shape. Browser-safe (no node deps): uses `globalThis.crypto.randomUUID`. Publish with
     * `kafka.publishEvent( Events.envelope( { … } ) )`.
     */
    export function envelope( input : EnvelopeInput ) : Envelope
    {
        const serviceId : string = ( input.object as string ).split( "." )[ 0 ];   // "account.member" → "account"
        return {
            version:    input.version ?? "1",
            eventId:    globalThis.crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            accountId:  input.accountId,
            actor:      input.actorUserId ? { kind: ActorKind.USER, id: input.actorUserId } : { kind: ActorKind.SERVICE, id: serviceId },
            object:     input.object,
            verb:       input.verb,
            action:     actionOf( input.object, input.verb ),
            target:     input.target,
            source:     { channel: input.source ?? SourceChannel.API },
            outcome:    input.outcome ?? Outcome.SUCCESS,
            data:       input.data,
            sinks:      [ Sink.KAFKA ],
        };
    }

    /** The Object (entity/topic) of an action — its `<service>.<noun>` prefix. */
    export function objectOf( action : Action ) : Object
    {
        const s : string = action as string;
        return s.slice( 0, s.lastIndexOf( "." ) ) as Object;
    }

    /** The Verb of an action — its last segment. */
    export function verbOf( action : Action ) : Verb
    {
        const s : string = action as string;
        return s.slice( s.lastIndexOf( "." ) + 1 ) as Verb;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ACCESS — per-(object, verb) metadata: the floor role to CONSUME (receive / subscribe / trigger / read)
    //   ONE map keyed by `Object` → `Verb` → meta. This is ALSO the catalog of VALID actions (the declared
    //   entries) — there is no separate per-service action enum to keep in sync. Access is per-VERB (e.g.
    //   `*.purged` can sit above `*.created`). Consumers read `Events.metaOf()` / `Events.canConsume()`;
    //   fail-closed (an undeclared object/verb → ROOT) so a new event never leaks early.
    // ──────────────────────────────────────────────────────────────────────────

    export interface ActionMeta
    {
        minAccess: Access.Role;   // floor role to RECEIVE / subscribe / trigger / read this event (within the account)
        category:  Category;      // grouping for pick-list UIs
    }

    // The single access registry — `Object` → `Verb` → meta. Declared entries are the valid catalog.
    const ACCESS : { [ O in Object ]? : Partial<Record<Verb, ActionMeta>> } =
    {
        // auth / identity
        [ Object.AUTH_SESSION ]:         { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY } },
        [ Object.AUTH_MFA_CHALLENGE ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY } },
        [ Object.AUTH_ROLE_ASSIGNMENT ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY } },
        [ Object.AUTH_PERMISSION ]:      { [ Verb.UPDATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY } },
        [ Object.AUTH_APIKEY ]:          { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY } },
        [ Object.AUTH_IMPERSONATION ]:   { [ Verb.CREATED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.SECURITY } },
        [ Object.AUTH_DATA ]:            { [ Verb.ACCESSED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.COMPLIANCE } },
        [ Object.AUTH_USER ]:            { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT } },
        [ Object.AUTH_PASSKEY ]:         { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.SECURITY } },

        // account
        [ Object.ACCOUNT_ACCOUNT ]:          { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.PURGED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.COMPLIANCE } },
        [ Object.ACCOUNT_MEMBER ]:           { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT } },
        [ Object.ACCOUNT_INVITE ]:           { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT } },
        [ Object.ACCOUNT_PLAN ]:             { [ Verb.CREATED ]: { minAccess: Access.AccountRole.BILLING, category: Category.BILLING }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.BILLING, category: Category.BILLING }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.BILLING, category: Category.BILLING }, [ Verb.PURGED ]: { minAccess: Access.AccountRole.BILLING, category: Category.BILLING } },
        [ Object.ACCOUNT_INVOICE ]:          { [ Verb.CREATED ]: { minAccess: Access.AccountRole.BILLING, category: Category.BILLING } },
        [ Object.ACCOUNT_BLOCK_LIST_ENTRY ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.ACCOUNT } },

        // contact
        [ Object.CONTACT_CONTACT ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT }, [ Verb.PURGED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.COMPLIANCE } },
        [ Object.CONTACT_CONSENT ]:   { [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT } },
        [ Object.CONTACT_FIELD_DEF ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.CONTACT } },
        [ Object.CONTACT_SEGMENT ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTACT } },
        [ Object.CONTACT_EXPORT ]:    { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.COMPLIANCE } },

        // campaign / orchestration
        [ Object.CAMPAIGN_CAMPAIGN ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.WORKFLOW_WORKFLOW ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.AUTOMATION }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.AUTOMATION }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.AUTOMATION } },
        [ Object.WORKFLOW_INSTANCE ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.AUTOMATION }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.AUTOMATION }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.AUTOMATION } },

        // channels
        [ Object.TEXTING_SUPPRESSION ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.EMAIL_TEMPLATE ]:      { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.EMAIL_SUPPRESSION ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.EMAIL_DOMAIN ]:        { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.MESSAGING }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.MESSAGING } },
        [ Object.VOICE_CALL ]:          { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.VOICE_SUPPRESSION ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.VOICE_IVR_FLOW ]:      { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.PRINT_MAILPIECE ]:     { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.PRINT_SUPPRESSION ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.PRINT_TEMPLATE ]:      { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.SOCIAL_POST ]:         { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.MESSAGING } },
        [ Object.SOCIAL_ACCOUNT ]:      { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.INTEGRATION }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.INTEGRATION } },
        [ Object.SURVEY_SURVEY ]:       { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.PURGED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.COMPLIANCE } },

        // registration / marketplace
        [ Object.REGISTRATION_NUMBER ]:       { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.MESSAGING }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.MESSAGING } },
        [ Object.MARKETPLACE_INTEGRATION ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.INTEGRATION }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.INTEGRATION } },
        [ Object.MARKETPLACE_OAUTH_TOKEN ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.INTEGRATION }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.INTEGRATION } },
        [ Object.MARKETPLACE_ZAPIER_ACTION ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.INTEGRATION } },

        // assets / links
        [ Object.MEDIA_ASSET ]:  { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.PURGED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.COMPLIANCE } },
        [ Object.MEDIA_JOB ]:    { [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },   // async stage progress (media-19.2)
        [ Object.LINKS_LINK ]:   { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.LINKS_DOMAIN ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.CONTENT } },

        // collaboration
        [ Object.COLLAB_ROOM ]:     { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.COLLAB_DOCUMENT ]: { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },

        // insight / ops
        [ Object.REPORT_REPORT ]:                { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.REPORT_SCHEDULE ]:              { [ Verb.CREATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.UPDATED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT }, [ Verb.DELETED ]: { minAccess: Access.AccountRole.USER, category: Category.CONTENT } },
        [ Object.MONITOR_ALARM ]:                { [ Verb.CREATED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.OPS }, [ Verb.UPDATED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.OPS }, [ Verb.DELETED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.OPS } },
        [ Object.AUDIT_LEGAL_HOLD ]:             { [ Verb.CREATED ]: { minAccess: Access.AppRole.ROOT, category: Category.COMPLIANCE }, [ Verb.DELETED ]: { minAccess: Access.AppRole.ROOT, category: Category.COMPLIANCE } },
        [ Object.AUDIT_EXPORT ]:                 { [ Verb.CREATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.COMPLIANCE } },
        [ Object.ANALYTICS_ATTRIBUTION_CONFIG ]: { [ Verb.UPDATED ]: { minAccess: Access.AccountRole.ACCOUNT, category: Category.OPS } },

        // cross-cutting
        [ Object.PLATFORM_CONFIG ]:       { [ Verb.UPDATED ]: { minAccess: Access.AppRole.ROOT, category: Category.OPS } },
        [ Object.PLATFORM_FEATURE_FLAG ]: { [ Verb.UPDATED ]: { minAccess: Access.AppRole.APPLICATION, category: Category.OPS } },
    };

    // FAIL-CLOSED default for an undeclared object/verb — most restrictive, so a new event never leaks early.
    const FAIL_CLOSED: ActionMeta = { minAccess: Access.AppRole.ROOT, category: Category.OPS };

    /** One catalog row — an action with its access + category (what a pick-list iterates). */
    export interface Entry extends ActionMeta { action: Action; }

    // -- accessors (the API every consumer uses) ----------------------------------------------------

    /** The metadata for an action (fail-closed to ROOT for an undeclared object/verb). */
    export function metaOf( action : Action ) : ActionMeta
    {
        return ACCESS[ objectOf( action ) ]?.[ verbOf( action ) ] ?? FAIL_CLOSED;
    }

    /** The minimum role to consume an action (receive / subscribe / trigger / read). */
    export function minAccessOf( action : Action ) : Access.Role
    {
        return metaOf( action ).minAccess;
    }

    /**
     * May a caller holding `role` CONSUME `action`? Used by realtime (push filter), workflow (trigger
     * eligibility), outbound webhooks (subscription gate), and audit reads. Ladder-aware via Access.
     */
    export function canConsume( role : Access.Role, action : Action ) : boolean
    {
        return Access.isAllowed( role, minAccessOf( action ) );
    }

    /** The full catalog — for pick-list UIs (workflow trigger picker, webhook subscription, …). */
    export function list() : ReadonlyArray<Entry>
    {
        const out : Array<Entry> = [];
        for( const [ object, verbs ] of globalThis.Object.entries( ACCESS ) as Array<[ Object, Partial<Record<Verb, ActionMeta>> ]> )
            for( const [ verb, meta ] of globalThis.Object.entries( verbs ) as Array<[ Verb, ActionMeta ]> )
                out.push( { action: actionOf( object, verb ), ...meta } );
        return out;
    }

    /** The catalog filtered to what `role` may consume — the role-scoped pick-list. */
    export function listConsumable( role : Access.Role ) : ReadonlyArray<Entry>
    {
        return list().filter( ( e ) => Access.isAllowed( role, e.minAccess ) );
    }
}

export default Events;
// eof
