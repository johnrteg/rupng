//
import { PostLoginPasskeyOptions } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Begin passkey sign-in → browser assertion options + ceremonyId (discoverable credential).
//
export class PostLoginPasskeyOptionsImpl extends PostLoginPasskeyOptions
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        try
        {
            const result = await this.service.passkeys.authenticationOptions();
            const reply : PostLoginPasskeyOptions.Response = { ceremonyId: result.ceremonyId, options: result.options as unknown as Record<string, unknown> };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "PostLoginPasskeyOptions", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default PostLoginPasskeyOptionsImpl;
