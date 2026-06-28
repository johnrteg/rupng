//
import { DeleteSession } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Logout — global sign-out of the caller's sessions.
//
export class DeleteSessionImpl extends DeleteSession
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
        try { await this.service.users.signOut( auth.username ); } catch( err ) { this.service.log.warn( "DeleteSession", err ); }
        const reply : DeleteSession.Response = { ok: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default DeleteSessionImpl;
