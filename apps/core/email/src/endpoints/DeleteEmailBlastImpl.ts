//
import { DeleteEmailBlast } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Cancel a blast (email-1.9) — status → CANCELLED; the worker halts the remaining fan-out. 404 if unknown.
//
export class DeleteEmailBlastImpl extends DeleteEmailBlast
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const id : string = this.query?.id ?? "";
        const cancelled : Type.Result<boolean> = await this.service.cancelBlast( auth.accountId, id, auth.userId );
        if( !cancelled.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not cancel the blast" } };
        if( !cancelled.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "blast not found" } };

        return { status: NetworkUtils.Status.OK, data: { cancelled: true } };
    }
}

export default DeleteEmailBlastImpl;
