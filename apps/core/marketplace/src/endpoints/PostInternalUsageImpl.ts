//
import { PostInternalUsage } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";

//
// S2S: the connector runtime reports usage deltas for the current period.
//
export class PostInternalUsageImpl extends PostInternalUsage
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostInternalUsage.Body | null = this.body;
        if( !body?.accountId || !body.integrationId )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and integrationId are required" } };

        const reported : Type.Result<void> = await this.service.reportUsage( body.accountId, body.integrationId, body.instanceId, {
            calls: body.calls, syncs: body.syncs, actions: body.actions, records: body.records,
        } );
        if( !reported.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "usage report failed" } };

        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostInternalUsageImpl;
