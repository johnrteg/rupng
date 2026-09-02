//
import { PostPrintProof, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Render a proof PDF for a template + sample merge data (print-1.4). Creates no mailpiece.
//
export class PostPrintProofImpl extends PostPrintProof
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostPrintProof.Body | null = this.body;
        if( !body?.templateId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "templateId is required" } };

        // the session's own accountId, never a client-supplied one — this is a user-facing (APP audience) route
        const rendered : Type.Result<Print.ProofResult> = await this.service.renderProof( auth.accountId, body.templateId, body.mergeData ?? {} );
        if( !rendered.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: rendered.error ?? "could not render proof" } };
        return { status: NetworkUtils.Status.OK, data: rendered.data };
    }
}

export default PostPrintProofImpl;
// eof
