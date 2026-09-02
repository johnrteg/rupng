//
import { PostPrintMailpieceApprove } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Approve a mailpiece's rendered proof (print-1.4). ACCOUNT — a spend-authorizing action.
//
export class PostPrintMailpieceApproveImpl extends PostPrintMailpieceApprove
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const approved : Type.Result<boolean> = await this.service.approveMailpiece( auth.accountId, this.query.id, auth.userId );
        if( !approved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not approve the mailpiece" } };
        if( !approved.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "mailpiece not found" } };
        return { status: NetworkUtils.Status.OK, data: { approved: true } };
    }
}

export default PostPrintMailpieceApproveImpl;
// eof
