//
import { GetVersion } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Service } from '../Service';

export class GetVersionImpl extends GetVersion
{
    private service : Service;

    ///////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : Service )
    {
        super();
        this.service = service;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // server-side fulfillment of the request
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const reply : GetVersion.Response = { service : this.service.name(), version : this.service.version };
        return { status : NetworkUtils.Status.OK, data : reply };
    }
}
