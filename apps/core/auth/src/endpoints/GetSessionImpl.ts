//
import { GetSession } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// The current session — the authenticated caller's composed User.Entity (Cognito ⊕ DynamoDB).
//
export class GetSessionImpl extends GetSession
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
        try
        {
            const profile = await this.service.users.profile( auth.userId );
            if( !profile ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "unknown user" } };
            return { status: NetworkUtils.Status.OK, data: profile };
        }
        catch( err )
        {
            this.service.log.error( "GetSession", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default GetSessionImpl;
