//
import { GetGenerateBatch, AiGen } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Poll an AI-generation staging batch (media-18) — the candidates with per-item status + a signed staging
// preview URL once READY. Nothing is in the library until the user promotes.
export class GetGenerateBatchImpl extends GetGenerateBatch
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.batchId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "batchId required" } };

        const batch : AiGen.Batch | undefined = await this.service.batchStatus( auth.accountId, this.query.batchId );
        if( !batch ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "batch not found" } };

        const reply : GetGenerateBatch.Response = { batch };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetGenerateBatchImpl;
