//
import { GetBootstrap } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AppService from '../services/AppService';

export class GetBootstrapImpl extends GetBootstrap
{
    private service : AppService;

    ///////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : AppService )
    {
        super();
        this.service = service;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // server-side fulfillment of the request
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const reply : GetBootstrap.Response = { maxUploadSize : { texting : 750_000 } };
        return { status : NetworkUtils.Status.OK, data : reply };
    }
}

