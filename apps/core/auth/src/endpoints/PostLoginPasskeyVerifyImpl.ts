//
import { PostLoginPasskeyVerify, User } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import Session from '../services/Session';

//
// Complete passkey sign-in — verify the assertion, then issue an auth session + return the user.
//
export class PostLoginPasskeyVerifyImpl extends PostLoginPasskeyVerify
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        let userId : string;
        try
        {
            userId = await this.service.passkeys.authenticationVerify( this.body!.ceremonyId, this.body!.response );
        }
        catch( err )
        {
            this.service.log.warn( "PostLoginPasskeyVerify", err );
            return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "passkey not verified" } };
        }

        const user : User.Entity | undefined = await this.service.users.profile( userId );
        const sessionToken : string = Session.issue( { userId, username: user?.email ?? userId, role: "user" } );
        const reply : PostLoginPasskeyVerify.Response = { complete: true, sessionToken, user };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostLoginPasskeyVerifyImpl;
