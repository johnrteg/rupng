//
import { DeleteMfaTotp } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Disable the authenticator app (TOTP) for the signed-in caller — turns off the software-token MFA
// preference in Cognito. User-scoped (the caller's access token).
//
export class DeleteMfaTotpImpl extends DeleteMfaTotp
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.token ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try
        {
            await this.service.users.disableTotp( auth.token );
            const reply : DeleteMfaTotp.Response = { disabled: true };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "DeleteMfaTotp", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default DeleteMfaTotpImpl;
