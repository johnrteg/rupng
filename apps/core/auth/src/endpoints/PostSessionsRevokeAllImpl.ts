//
import { PostSessionsRevokeAll } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/services';
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
        const who : string = auth.userId ?? auth.username;
        void this.service.emit( Events.Object.AUTH_SESSION, Events.Verb.DELETED, "session", who, auth.accountId ?? who, { userId: auth.userId, username: auth.username, all: true, at: new Date().toISOString() }, auth.userId );
        const reply : PostSessionsRevokeAll.Response = { ok: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostSessionsRevokeAllImpl;
