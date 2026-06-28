//
import { GetPasskeys } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// List the caller's enrolled passkeys.
//
export class GetPasskeysImpl extends GetPasskeys
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try
        {
            const passkeys = await this.service.passkeys.list( auth.userId );
            const reply : GetPasskeys.Response = { passkeys };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "GetPasskeys", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default GetPasskeysImpl;
