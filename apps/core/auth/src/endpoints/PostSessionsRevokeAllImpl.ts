//
import { PostSessionsRevokeAll } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Sign out everywhere — global sign-out of the caller's sessions (Cognito), best-effort.
//
export class PostSessionsRevokeAllImpl extends PostSessionsRevokeAll
{
    private service : AuthService;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : AuthService )
    {
        super();
        this.service = service;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.username ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try { await this.service.users.signOut( auth.username ); } catch( err ) { this.service.log.warn( "PostSessionsRevokeAll", err ); }
        const reply : PostSessionsRevokeAll.Response = { ok: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostSessionsRevokeAllImpl;
