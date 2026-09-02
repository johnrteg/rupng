//
// AuditView — the boundary mapping between the app-internal `Audit.StoredEvent` (this package's
// `AuditModel.ts`) and the WIRE-facing `Audit.EventView` (`@repo/api`'s `audit/model/Audit.ts`), plus
// the shared in-memory filter predicate every query/export endpoint applies. One place, so the two
// query endpoints (tenant + staff) and the export endpoint can't drift on either mapping.
//
import { Audit as AuditWire } from "@repo/api";
import { Audit } from "../AuditModel";

/** Project an internal `StoredEvent` onto the public wire shape — same fields, different namespace. */
export function toEventView( row : Audit.StoredEvent ) : AuditWire.EventView
{
    return {
        eventId:        row.eventId,
        occurredAt:     row.occurredAt,
        accountId:      row.accountId,
        actor:          row.actor,
        action:         row.action,
        target:         row.target,
        source:         row.source,
        outcome:        row.outcome,
        context:        row.context,
        seq:            row.seq,
        ingestedAt:     row.ingestedAt,
        retentionClass: row.retentionClass as unknown as AuditWire.RetentionClass,
        prevHash:       row.prevHash,
        hash:           row.hash,
        legalHold:      row.legalHold,
    };
}

/** The non-tenant-scoping filter fields common to `GetAuditEvents`/`GetStaffAuditEvents`/`PostAuditExport`
 *  (tenant scoping itself is applied by the caller's DynamoDB `KeyConditionExpression`, not here). */
export interface EventFilter
{
    actorId?:    string;
    action?:     string;
    targetType?: string;
    targetId?:   string;
    outcome?:    string;
    from?:       string;
    to?:         string;
}

export function matchesFilter( row : Audit.StoredEvent, filter : EventFilter ) : boolean
{
    if( filter.actorId    && row.actor.id       !== filter.actorId )    return false;
    if( filter.action     && row.action         !== filter.action )     return false;
    if( filter.targetType && row.target.type    !== filter.targetType ) return false;
    if( filter.targetId   && row.target.id      !== filter.targetId )   return false;
    if( filter.outcome    && row.outcome        !== filter.outcome )    return false;
    if( filter.from       && row.occurredAt     <  filter.from )        return false;
    if( filter.to         && row.occurredAt     >  filter.to )          return false;
    return true;
}
