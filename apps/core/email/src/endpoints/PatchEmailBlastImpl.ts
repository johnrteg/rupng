//
import { PatchEmailBlast, Email } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Control a blast (email-1.9) — suspend / resume / reschedule. Delegates the state-machine + safe-buffer check
// to the service; maps a not-found → 404 and an invalid-for-status → 409.
//
export class PatchEmailBlastImpl extends PatchEmailBlast
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const id : string = this.query?.id ?? "";
        const action : Email.BlastAction | undefined = this.body?.action;
        if( action === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "action is required" } };

        const controlled : Type.Result<Email.Blast | undefined> = await this.service.controlBlast( auth.accountId, id, action, this.body?.startAt, auth.userId );
        if( !controlled.ok )
        {
            // a conflict string = invalid action for the blast's current status; else a DB error
            const conflict : boolean = controlled.error.startsWith( "conflict" );
            return { status: conflict ? NetworkUtils.Status.CONFLICT : NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: controlled.error } };
        }
        if( controlled.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "blast not found" } };

        return { status: NetworkUtils.Status.OK, data: { blast: controlled.data } };
    }
}

export default PatchEmailBlastImpl;
