//
import { GetBrowseProviders, Browse } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaBrowseService from '../services/MediaBrowseService';

// List the Browse providers enabled + usable (keyed) for the account, with capabilities (media-13).
export class GetBrowseProvidersImpl extends GetBrowseProviders
{
    private service : MediaBrowseService;
    constructor( service : MediaBrowseService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const providers : Array<Browse.ProviderInfo> = await this.service.listProviders();
        return { status: NetworkUtils.Status.OK, data: { providers } };
    }
}

export default GetBrowseProvidersImpl;
