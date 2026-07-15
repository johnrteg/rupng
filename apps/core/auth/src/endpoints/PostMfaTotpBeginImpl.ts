//
import { PostMfaTotpBegin } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Begin authenticator-app (TOTP) enrolment for the signed-in caller → shared secret + otpauth:// URI.
// User-scoped (Cognito AssociateSoftwareToken with the caller's access token).
//
export class PostMfaTotpBeginImpl extends PostMfaTotpBegin
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.token ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try
        {
            const label : string = auth.username ?? auth.userId ?? "account";
            const setup = await this.service.users.beginTotp( auth.token, label );
            const reply : PostMfaTotpBegin.Response = { secret: setup.secret, otpauthUri: setup.otpauthUri };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "PostMfaTotpBegin", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default PostMfaTotpBeginImpl;
