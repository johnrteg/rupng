//
import { PostAuditExport, Audit as AuditWire } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";

import AuditQueryService from "../services/AuditQueryService";
import { Audit } from "../AuditModel";
import { toEventView, matchesFilter } from "./AuditView";

//
// Filtered export of the acting account's audit trail — DSAR / SOC 2 evidence (audit-5.3). The export
// action lands in the trail through the SAME `Application.audit()` path every other action uses — no
// special-cased "audit of audit" endpoint; this satisfies audit-5.3 structurally.
//
export class PostAuditExportImpl extends PostAuditExport
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const filter : AuditWire.QueryFilter = this.body?.filter ?? {};
        const format : "json" | "csv" = this.body?.format ?? "json";

        const found : Type.Result<Array<Audit.StoredEvent>> = await this.service.dynamo.query<Audit.StoredEvent>( "events", {
            KeyConditionExpression:    "accountId = :a AND begins_with(sk, :evt)",
            ExpressionAttributeValues: { ":a": accountId, ":evt": "EVT#" },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "audit read failed" } };

        const rows : Array<AuditWire.EventView> = found.data
            .filter( ( row : Audit.StoredEvent ) : boolean => matchesFilter( row, filter ) )
            .sort( ( a : Audit.StoredEvent, b : Audit.StoredEvent ) : number => a.seq - b.seq )
            .map( toEventView );

        // audit-5.3 — the export ITSELF is a recorded action (both the domain Kafka event AND the audit
        // trail entry — `Application.audit()` is the one emitter every action uses).
        await this.service.audit( {
            action:      Events.actionOf( Events.Object.AUDIT_EXPORT, Events.Verb.CREATED ),
            accountId,
            target:      { type: "audit_trail", id: accountId },
            actorUserId: auth.userId,
            context:     { format, rowCount: rows.length },
        } );

        const result : AuditWire.ExportResult = { rows, format, rowCount: rows.length };
        return { status: NetworkUtils.Status.OK, data: result };
    }
}

export default PostAuditExportImpl;
