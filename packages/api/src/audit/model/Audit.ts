//
// Audit — the WIRE-facing model for the audit service's read + admin surface (`@repo/api/audit/*`
// endpoint contracts). Structurally mirrors `apps/core/audit/src/AuditModel.ts`'s internal
// `StoredEvent`/`RetentionPolicy`/`LegalHold`/`ExportRequest` BY DESIGN — that app-internal model can't
// be imported here (apps depend on packages, never the reverse), so the service's endpoint impls map
// its internal `Audit.StoredEvent` DDB item onto `Audit.EventView` at the boundary. Keep the two in
// sync when either changes (same discipline as any other service's internal-vs-wire model split).
//
import type { Type } from "@repo/common";
import { Events } from "@repo/system";

export namespace Audit
{
    /** Each event carries a retention class; a class may be configured to a longer tier where law
     *  requires (audit-4.1). Mirrors `apps/core/audit/src/AuditModel.ts`'s `Audit.RetentionClass`. */
    export enum RetentionClass
    {
        SECURITY    = "security",
        COMPLIANCE  = "compliance",
        FINANCIAL   = "financial",
        OPERATIONAL = "operational",
    }

    /** One persisted audit event, as returned to a caller (audit-5.1). `hash`/`prevHash`/`seq` are
     *  exposed so a caller can independently verify the tenant's hash chain over a range (audit-3.2). */
    export interface EventView
    {
        eventId:        Type.ID;
        occurredAt:     Type.ISODateTime;
        accountId:      Type.ID;
        actor:          Events.Actor;
        action:         Events.Action;
        target:         Events.Target;
        source:         Events.Source;
        outcome:        Events.Outcome;
        context?:       Events.Context;
        seq:            number;
        ingestedAt:     Type.ISODateTime;
        retentionClass: RetentionClass;
        prevHash:       string;
        hash:           string;
        legalHold?:     boolean;
    }

    /** Filter for `GET /audit/events` (+ `/audit/events/staff`). RBAC + tenant scoping applied on top —
     *  an account-scoped caller's `accountId` is pinned server-side, never taken from this filter. */
    export interface QueryFilter
    {
        accountId?:  Type.ID;
        actorId?:    Type.ID;
        action?:     Events.Action;
        targetType?: string;
        targetId?:   Type.ID;
        outcome?:    Events.Outcome;
        from?:       Type.ISODateTime;
        to?:         Type.ISODateTime;
    }

    /** Env-configurable retention (AppConfig, `AuditConfig`) — default dev 1 week / prod 1 year;
     *  `byClass` overrides the default for a specific class (e.g. financial → 7 years). */
    export interface RetentionPolicy
    {
        defaultDays: number;
        byClass?:    Partial<Record<RetentionClass, number>>;
    }

    /** A litigation/investigation freeze — overrides retention expiry for a scope until released. */
    export interface LegalHold
    {
        holdId:      Type.ID;
        accountId:   Type.ID;
        subjectId?:  Type.ID;
        from?:       Type.ISODateTime;
        to?:         Type.ISODateTime;
        reason:      string;
        placedBy:    Type.ID;
        placedAt:    Type.ISODateTime;
        releasedBy?: Type.ID;
        releasedAt?: Type.ISODateTime;   // absent = active
    }

    /** A filtered export for DSAR / SOC 2 evidence (the export action is itself audited — audit-5.3). */
    export interface ExportRequest { filter : QueryFilter; format : "json" | "csv"; }

    /** The result of a filtered export — the rows plus a summary of what was exported (the summary,
     *  not the rows, is what lands in the audit trail for the export action itself). */
    export interface ExportResult { rows : Array<EventView>; format : "json" | "csv"; rowCount : number; }
}

export default Audit;
// eof
