//
import { PostMfaTotpVerify } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Confirm authenticator-app (TOTP) enrolment: verify the 6-digit code and, on success, enable software-
// token MFA as the caller's preferred factor. User-scoped (Cognito VerifySoftwareToken via access token).
//
export class PostMfaTotpVerifyImpl extends PostMfaTotpVerify
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.token ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const code : string = ( this.body?.code ?? "" ).trim();
        if( code === "" ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "code required" } };

        try
        {
            const verified : boolean = await this.service.users.verifyTotp( auth.token, code );
            const reply : PostMfaTotpVerify.Response = { verified };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "PostMfaTotpVerify", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default PostMfaTotpVerifyImpl;
