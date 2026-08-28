//
import { PostGeneratePromote } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Promote selected staged candidates (media-18) into the account library — copies the chosen candidates' bytes
// from staging into the media bucket as generated Media.Assets, then discards the batch. 404 if the batch is gone.
export class PostGeneratePromoteImpl extends PostGeneratePromote
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostGeneratePromoteImpl", { userId: auth.userId, accountId: auth.accountId, batchId: this.query?.batchId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.batchId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "batchId required" } };

        const candidateIds : Array<string> = this.body?.candidateIds ?? [];
        if( candidateIds.length === 0 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "select at least one candidate" } };

        const outcome : { status : number; assets? : Array<{ guid : string; name : string }> } =
            await this.service.promoteBatch( auth, this.query.batchId, candidateIds, this.body?.name, this.body?.tags, this.body?.campaignIds );

        if( outcome.status === NetworkUtils.Status.OK && outcome.assets )
        {
            const reply : PostGeneratePromote.Response = { assets: outcome.assets };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        const message : string = outcome.status === NetworkUtils.Status.NOT_FOUND ? "batch not found" : "could not add to library";
        return { status: outcome.status, data: { message } };
    }
}

export default PostGeneratePromoteImpl;
