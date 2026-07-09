//
import { GetOpenApi, PublicApi } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AppService from '../services/AppService';

//
// Serve the published API's OpenAPI 3.1 document, generated live from the PUBLIC endpoint contracts
// (PublicApi.document). No datastore read — it's a pure projection of the code, so it can never drift from
// what the server actually serves. The in-app Scalar viewer + readme.io sync both consume this same shape.
//
export class GetOpenApiImpl extends GetOpenApi
{
    private service : AppService;
    constructor( service : AppService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        // build the document from the curated public registry (parameterless contracts → OpenAPI 3.1)
        const reply : GetOpenApi.Response = PublicApi.document();
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetOpenApiImpl;
