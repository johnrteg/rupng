//
import { GetAuditEvents, Audit as AuditWire, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";

import AuditQueryService from "../services/AuditQueryService";
import { Audit } from "../AuditModel";
import { toEventView, matchesFilter } from "./AuditView";

//
// Query the ACTING ACCOUNT's audit trail (audit-5.1) — accountId is pinned server-side from the
// caller's auth, never taken from the query. Reading the trail is itself audited (audit-5.2).
//
export class GetAuditEventsImpl extends GetAuditEvents
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Audit.StoredEvent>> = await this.service.dynamo.query<Audit.StoredEvent>( "events", {
            KeyConditionExpression:    "accountId = :a AND begins_with(sk, :evt)",
            ExpressionAttributeValues: { ":a": accountId, ":evt": "EVT#" },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "audit read failed" } };

        const query : GetAuditEvents.Query = this.query ?? {};
        const rows : Array<Audit.StoredEvent> = found.data
            .filter( ( row : Audit.StoredEvent ) : boolean => matchesFilter( row, query ) )
            .sort( ( a : Audit.StoredEvent, b : Audit.StoredEvent ) : number => b.seq - a.seq );   // newest-first

        const paged : Paging.Result<AuditWire.EventView> = Paging.paginate( rows.map( toEventView ), query );

        // audit-5.2 — reading the trail is itself audited, same mechanism as any other action.
        await this.service.audit( {
            action:      Events.actionOf( Events.Object.AUDIT_EVENT, Events.Verb.ACCESSED ),
            accountId,
            target:      { type: "audit_trail", id: accountId },
            actorUserId: auth.userId,
            context:     { count: paged.records.length },
        } );

        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetAuditEventsImpl;
