//
import { GetAuditEvent, Audit as AuditWire } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";

import AuditQueryService from "../services/AuditQueryService";
import { Audit } from "../AuditModel";
import { toEventView } from "./AuditView";

//
// Fetch a single audit event by id, tenant-scoped (audit-5.1). `id` here is the event's `seq`
// (zero-padded — see `AuditHashChain.eventSk`) since that IS the item's sort key within the account
// partition; a caller reads `seq` off a prior `GetAuditEvents` page. Reading is itself audited (audit-5.2).
//
export class GetAuditEventImpl extends GetAuditEvent
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const seq : number = Number( this.query?.id ?? "" );
        if( !Number.isFinite( seq ) ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no such event" } };

        const got : Type.Result<Audit.StoredEvent | undefined> = await this.service.dynamo.get<Audit.StoredEvent>( "events", { accountId, sk: `EVT#${ String( seq ).padStart( 12, "0" ) }` } );
        if( !got.ok )      return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "audit read failed" } };
        if( !got.data )    return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no such event" } };

        const view : AuditWire.EventView = toEventView( got.data );

        await this.service.audit( {
            action:      Events.actionOf( Events.Object.AUDIT_EVENT, Events.Verb.ACCESSED ),
            accountId,
            target:      { type: "audit_event", id: String( seq ) },
            actorUserId: auth.userId,
        } );

        return { status: NetworkUtils.Status.OK, data: view };
    }
}

export default GetAuditEventImpl;
