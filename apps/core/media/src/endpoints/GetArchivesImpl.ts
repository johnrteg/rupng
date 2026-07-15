//
import { GetArchives, Media } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// The account's download archives (the "Downloads" view, media-20) — each with status + error reason.
export class GetArchivesImpl extends GetArchives
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const archives : Array<Media.Archive> = await this.service.listArchives( auth.accountId );
        return { status: NetworkUtils.Status.OK, data: { archives } };
    }
}

export default GetArchivesImpl;
