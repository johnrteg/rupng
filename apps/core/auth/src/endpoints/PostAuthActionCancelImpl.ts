//
import { PostAuthActionCancel } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuthService from "../services/AuthService";

//
// Cancel a pending action (INTERNAL) — the Console revokes a queued action so its landing link stops working.
//
export class PostAuthActionCancelImpl extends PostAuthActionCancel
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const actionId : string = this.query?.actionId ?? "";
        const cancelled : Type.Result<boolean> = await this.service.actions.cancel( actionId );
        if( !cancelled.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not cancel the action" } };
        return { status: NetworkUtils.Status.OK, data: { ok: cancelled.data } };
    }
}

export default PostAuthActionCancelImpl;
