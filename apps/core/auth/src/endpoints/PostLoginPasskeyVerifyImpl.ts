//
import { PostLoginPasskeyVerify, User } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
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
        const verified : Type.Result<string> = await this.service.passkeys.authenticationVerify( this.body!.ceremonyId, this.body!.response );
        if( !verified.ok )
        {
            this.service.log.warn( "PostLoginPasskeyVerify", { error: verified.error } );
            return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "passkey not verified" } };
        }
        const userId : string = verified.data;

        const user : User.Entity | undefined = await this.service.users.profile( userId );
        const sessionToken : string = Session.issue( { userId, username: user?.email ?? userId, role: "user" } );
        void this.service.publishLogin( userId, user?.email );   // stamps users.lastLoginAt + auth.session.created
        const reply : PostLoginPasskeyVerify.Response = { complete: true, sessionToken, user };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostLoginPasskeyVerifyImpl;
