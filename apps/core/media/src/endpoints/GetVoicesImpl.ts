//
import { GetVoices, Media } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// The account's cloned voices (media-21).
export class GetVoicesImpl extends GetVoices
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const voices : Array<Media.Voice> = await this.service.listVoices( auth.accountId );
        return { status: NetworkUtils.Status.OK, data: { voices } };
    }
}

export default GetVoicesImpl;
