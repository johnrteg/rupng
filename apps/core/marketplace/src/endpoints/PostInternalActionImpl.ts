//
import { PostInternalAction } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// S2S: validate + enqueue an outbound action. MarketplaceActionJob does the actual provider call.
//
export class PostInternalActionImpl extends PostInternalAction
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostInternalAction.Body | null = this.body;
        if( !body?.accountId || !body.installationId || !body.method || !body.endpoint )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, installationId, method, and endpoint are required" } };

        const enqueued : Type.Result<void> = await this.service.sqs.send( "marketplace-actions", body );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "action enqueue failed" } };

        return { status: NetworkUtils.Status.OK, data: { accepted: true } };
    }
}

export default PostInternalActionImpl;
