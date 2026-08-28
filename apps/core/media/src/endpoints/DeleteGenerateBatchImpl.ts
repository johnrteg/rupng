//
import { DeleteGenerateBatch } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Discard an AI-generation staging batch (media-18) — deletes the staged bytes + batch row. Nothing was in the
// library, so this only cleans up staging.
export class DeleteGenerateBatchImpl extends DeleteGenerateBatch
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: DeleteGenerateBatchImpl", { userId: auth.userId, accountId: auth.accountId, batchId: this.query?.batchId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.batchId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "batchId required" } };

        const outcome : { status : number } = await this.service.discardBatch( auth.accountId, this.query.batchId );
        if( outcome.status === NetworkUtils.Status.OK ) return { status: NetworkUtils.Status.OK, data: { discarded: true } };

        const message : string = outcome.status === NetworkUtils.Status.NOT_FOUND ? "batch not found" : "could not discard batch";
        return { status: outcome.status, data: { message } };
    }
}

export default DeleteGenerateBatchImpl;
