//
import { GetArchiveUrl } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// A time-limited download URL for a complete archive (media-20).
export class GetArchiveUrlImpl extends GetArchiveUrl
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetArchiveUrlImpl", { accountId: auth.accountId, archiveId: this.query?.archiveId } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.archiveId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "archiveId required" } };
        const url : string | null = await this.service.archiveUrl( auth.accountId, this.query.archiveId );
        if( !url ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "archive not ready" } };
        return { status: NetworkUtils.Status.OK, data: { url } };
    }
}

export default GetArchiveUrlImpl;
