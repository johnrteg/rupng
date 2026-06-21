//
// Audit domain model — the platform's single, immutable, action-level audit trail.
//
// Everything is scoped under the `Audit` namespace:
//   Audit.Event        (the EMITTED contract — who/what/when/where/outcome; every service emits this)
//   Audit.StoredEvent  (what the single-writer sink PERSISTS — Event + accountId + seq + hash chain)
//   Audit.LegalHold / Audit.RetentionPolicy  (retention + litigation freeze)
//   Audit.* query/export payloads (the read + admin surface)
//
// Scalars come from `Type` in @repo/common (ID, ISODateTime, JsonPrimitive); the role ladder from
// `Access` in @repo/endpoint.
//
// ── Where the contract lives (SPECS audit-1.1) ──────────────────────────────────────────────────
//   The emitted event is the CENTRALIZED `Events.Envelope` from @repo/common — the platform-wide
//   contextual event every service emits (via `Application.audit()` → SQS) and that fans out to MANY
//   sinks (audit, Kafka, realtime, change-history, monitor). Audit does NOT own the vocabulary; it
//   owns only the SINK + STORE + READ. `Audit.Event` is that shared envelope + audit-only metadata
//   (retention class); the storage / retention / query types below are audit-service-only.
//
// ── The TWO hard rules ──────────────────────────────────────────────────────────────────────────
//   (1) PII-LIGHT (audit-1.1 / 3.x): inherited from `Events.Envelope` — `target` is an id, never a
//       value; `context` is ids + enums + counts, NEVER field values or message content. This is what
//       lets the trail be retained for YEARS and survive a GDPR forget untouched (field-level
//       before/after diffs live in each owning service's change-history, PII-dense, a separate layer).
//   (2) WRITE-ONCE (audit-2.1 / 2.2): events arrive ONLY over SQS; `AuditSinkJob` is the single
//       writer; there is NO update/delete — not even for root. Tamper-evidence = a per-tenant hash
//       chain + S3 Object Lock.
//
// Storage (SPECS "Architecture"):
//   emit → SQS audit queue (+ DLQ) → AuditSinkJob: validate → stamp seq + hash-chain → hot DynamoDB
//          (PK accountId, SK at#seq) → DDB Streams → S3 Object Lock (WORM, Parquet) for long retention + Athena.
//

import type { Type }      from "@repo/common";
import { Access, Events } from "@repo/endpoint";  // Access (role enums) + the centralized event vocabulary + access

export namespace Audit
{
    // ──────────────────────────────────────────────────────────────────────────
    // Shared vocabulary — re-exported from @repo/common `Events` (single source of truth)
    //   Actor · Action (verb catalog) · Target · Source · Outcome · Context all live centrally so
    //   the SAME contextual event flows to audit / Kafka / realtime / change-history. Aliased here
    //   for ergonomics (call sites read `Audit.Actor`, etc.) without a second definition.
    // ──────────────────────────────────────────────────────────────────────────

    export import ActorKind     = Events.ActorKind;
    export import Actor         = Events.Actor;
    export import Target        = Events.Target;
    export import SourceChannel = Events.SourceChannel;
    export import Source        = Events.Source;
    export import Outcome       = Events.Outcome;
    export type   Action        = Events.Action;    // the unified per-service union (type-only)
    export type   Context       = Events.Context;

    // ──────────────────────────────────────────────────────────────────────────
    // Retention — tier + env policy (configurable; legal hold overrides)
    // ──────────────────────────────────────────────────────────────────────────

    /** Each event carries a retention class; a class may be configured to a longer tier where law requires. */
    export enum RetentionClass
    {
        SECURITY    = "security",
        COMPLIANCE  = "compliance",
        FINANCIAL   = "financial",
        OPERATIONAL = "operational",
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Event — the audit-flavored event = the shared envelope + a retention hint
    //   The wire shape IS `Events.Envelope` (eventId · occurredAt · accountId · actor · action ·
    //   target · source · outcome · context). Audit adds only `retentionClass` (an emitter hint).
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * An audit event as EMITTED — `Events.Envelope` plus `retentionClass`. (`time` of the action is
     * the envelope's `occurredAt`.) Emitted by every service via `Application.audit()` → SQS.
     */
    export interface Event extends Events.Envelope
    {
        retentionClass?: RetentionClass;   // emitter hint; the sink applies the policy default if absent
    }

    /**
     * Env-configurable retention (AppConfig). Default **dev = 1 week, prod = 1 year** (matches `auth-19.5`).
     * `byClass` overrides the default for a specific class (e.g. financial → 7 years). Expiry is always
     * defensible + LOGGED + legal-hold-aware (audit-4.1).
     */
    export interface RetentionPolicy
    {
        defaultDays: number;                                  // env default (dev 7 / prod 365)
        byClass?:    Partial<Record<RetentionClass, number>>; // per-class longer tiers
    }

    /**
     * A litigation/investigation freeze — overrides retention expiry for a scope until released.
     * Scope is by account and optionally a subject (an opaque id) and/or a time range.
     */
    export interface LegalHold
    {
        holdId:      Type.ID;
        accountId:   Type.ID;
        subjectId?:  Type.ID;            // opaque actor/target id, when scoped to a subject
        from?:       Type.ISODateTime;   // time-range scope (inclusive)
        to?:         Type.ISODateTime;
        reason:      string;
        placedBy:    Type.ID;            // staff actor (audited)
        placedAt:    Type.ISODateTime;
        releasedBy?: Type.ID;
        releasedAt?: Type.ISODateTime;   // absent = active
    }

    // ──────────────────────────────────────────────────────────────────────────
    // StoredEvent — what the single-writer sink PERSISTS (append-only, hash-chained)
    //   pk = ACCOUNT#<accountId>   sk = <occurredAt>#<seq>   (recent in DDB; mirrored to S3 Object Lock)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * The persisted record: the emitted `Event` plus the sink's tamper-evidence stamps. WRITE-ONCE —
     * there is no update/delete. `seq` is monotonic per tenant; `hash = H(prevHash ‖ canonical(event))`
     * so the per-tenant chain makes any gap / edit / reorder detectable on verify-on-read (audit-3.2).
     */
    export interface StoredEvent extends Event
    {
        seq:             number;            // monotonic per accountId (ordering + gap detection)
        ingestedAt:      Type.ISODateTime;  // when the sink wrote it (vs `occurredAt` = when it happened)
        retentionClass:  RetentionClass;    // resolved (emitter hint or policy default)
        prevHash:        string;            // hash of the prior record in this tenant's chain ("" / genesis for seq 0)
        hash:            string;            // H(prevHash ‖ canonical(event)) — this record's chain link
        legalHold?:      boolean;           // true while any active LegalHold covers it (blocks expiry)
        archivedAt?:     Type.ISODateTime;  // set once mirrored to S3 Object Lock (AuditArchiveJob)
    }

    /** Result of verifying a tenant's hash chain over a range (audit-3.2; runs on read/export). */
    export interface ChainVerification
    {
        accountId: Type.ID;
        fromSeq:   number;
        toSeq:     number;
        intact:    boolean;
        brokenAt?: number;   // the first seq where the chain failed, when !intact
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Query & export — the read + admin surface (audit-5.x). NO write surface exists.
    // ──────────────────────────────────────────────────────────────────────────

    /** Filter for `GET /audit/events`. RBAC + tenant scoping applied on top (staff may span accounts). */
    export interface QueryFilter
    {
        accountId?:  Type.ID;     // pinned for account admins; staff/auditor may omit for cross-tenant
        actorId?:    Type.ID;
        action?:     Action;
        targetType?: string;
        targetId?:   Type.ID;
        outcome?:    Outcome;
        from?:       Type.ISODateTime;
        to?:         Type.ISODateTime;
    }

    /** The standard read envelope (mirrors the platform `{ data, page }` shape; `at#seq` cursor). */
    export interface Page { cursor?: string; nextCursor?: string; limit: number; }
    export interface Result<T> { data: Array<T>; page?: Page; }

    /** A filtered export for DSAR / SOC 2 evidence (the export action is itself audited — audit-5.3). */
    export interface ExportRequest { filter: QueryFilter; format: "json" | "csv"; }

    // ──────────────────────────────────────────────────────────────────────────
    // Access — recommended minimum roles on the read/admin surface (RBAC layered on top)
    // ──────────────────────────────────────────────────────────────────────────

    export const TENANT_READ_MIN_ACCESS: Access.AccountRole = Access.AccountRole.ACCOUNT; // own-tenant trail
    export const STAFF_READ_MIN_ACCESS:  Access.AppRole     = Access.AppRole.APPLICATION;  // cross-tenant view
    export const LEGAL_HOLD_MIN_ACCESS:  Access.AppRole     = Access.AppRole.ROOT;         // place/release holds
}

export default Audit;
// eof
