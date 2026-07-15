//
import { GetApiKeys, ApiKey } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import type { Type } from '@repo/common';
import AuthService from '../services/AuthService';

//
// List the acting account's developer API keys (secret-free views). Account-scoped via X-Account → auth.accountId.
//
export class GetApiKeysImpl extends GetApiKeys
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "account context required" } };

        // read this account's keys from the store; a data-layer failure maps to 500
        const listed : Type.Result<Array<ApiKey.View>> = await this.service.apiKeys.list( auth.accountId );
        if( !listed.ok )
        {
            this.service.log.error( "GetApiKeys", listed.error );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
        const reply : GetApiKeys.Response = { keys: listed.data };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetApiKeysImpl;
