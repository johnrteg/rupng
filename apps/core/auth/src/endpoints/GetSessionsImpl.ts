//
import { GetSessions } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// STUB — list the caller's sessions/devices. Returns empty until the sessions table is wired.
// TODO: query the `sessions` table (GSI userId) and flag the current session.
//
export class GetSessionsImpl extends GetSessions
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
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const reply : GetSessions.Response = { sessions: [] };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetSessionsImpl;
