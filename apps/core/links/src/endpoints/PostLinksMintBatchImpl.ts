//
import { PostLinksMintBatch, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// Bulk-mint tracked links for a campaign send (links-1.1) — one mint per recipient, best-effort
// (a single recipient's failure doesn't abort the batch).
//
export class PostLinksMintBatchImpl extends PostLinksMintBatch
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const requests : Array<Links.MintRequest> = this.body?.requests ?? [];
        if( requests.length === 0 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no requests" } };

        const results : Array<Links.MintResult> = [];
        for( const request of requests )
        {
            const minted : Type.Result<Links.MintResult> = await this.service.mint( request );
            if( minted.ok ) results.push( minted.data );
            else this.service.log.warn( "batch mint: one request failed — skipping", { accountId: request.accountId, error: minted.error } );
        }

        return { status: NetworkUtils.Status.OK, data: { results } };
    }
}

export default PostLinksMintBatchImpl;
// eof
