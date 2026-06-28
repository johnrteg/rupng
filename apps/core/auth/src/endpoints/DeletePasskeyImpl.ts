//
import { DeletePasskey } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Remove one of the caller's passkeys by credential id (404 if it isn't theirs).
//
export class DeletePasskeyImpl extends DeletePasskey
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try
        {
            const deleted : boolean = await this.service.passkeys.remove( auth.userId, this.query?.credentialId ?? "" );
            if( !deleted ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "passkey not found" } };
            const reply : DeletePasskey.Response = { deleted: true };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "DeletePasskey", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default DeletePasskeyImpl;
