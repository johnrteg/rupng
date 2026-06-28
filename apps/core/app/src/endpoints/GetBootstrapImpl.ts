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
    // server-side fulfillment of the request — live read of the WEB config from AppConfig
    // (profile "web"), falling back to GetBootstrap.SEED. A Redis cache will front this later.
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const reply : GetBootstrap.Response = await this.service.getWebConfig();
        this.service.log.info('GetBootstrapImpl', reply );
        return { status : NetworkUtils.Status.OK, data : reply };
    }
}

