//
import { PostPasskeyRegisterOptions } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Begin passkey enrolment for the signed-in caller → browser creation options + ceremonyId.
//
export class PostPasskeyRegisterOptionsImpl extends PostPasskeyRegisterOptions
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try
        {
            const result = await this.service.passkeys.registrationOptions( auth.userId, auth.username ?? auth.userId );
            const reply : PostPasskeyRegisterOptions.Response = { ceremonyId: result.ceremonyId, options: result.options as unknown as Record<string, unknown> };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "PostPasskeyRegisterOptions", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default PostPasskeyRegisterOptionsImpl;
