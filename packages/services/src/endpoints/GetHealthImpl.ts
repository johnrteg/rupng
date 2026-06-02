//
import { FastifyRequest } from 'fastify';

import { GetHealth } from '@repo/api';
import { Network } from '@repo/common';
import { Endpoint } from '@repo/endpoint';
import { Service } from '../Service';

export class GetHealthImpl extends GetHealth
{
    private service : Service;

    ///////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : Service )
    {
        super();
        this.service = service;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // child classes need to override this method
    // take the request and set this.request values
    //
    public validateData( request : Endpoint.ClientRequest) : Endpoint.DataCheck
    {
        this.service.log.info('GetHealthImpl::validateData', request );
        return { ok : true };   // default
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // 10d546478ce523457fab8079998ecc2a25:5b4adf9682fb4a50910dd8ac8fe975c8
    public async execute( auth : Endpoint.Authentication ) : Promise<Endpoint.Response>
    {
        //const id : string = this.service.id;
        const reply : GetHealth.Response = { ok : true };
        return { status : Network.Status.OK, data : reply };
    }
}

