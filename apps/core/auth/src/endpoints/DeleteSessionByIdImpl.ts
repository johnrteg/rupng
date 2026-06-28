//
import { DeleteSessionById } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// STUB — revoke a specific session by id. Reports ok.
// TODO: delete the `sessions` row + add its token to the revocation set (epoch/blacklist).
//
export class DeleteSessionByIdImpl extends DeleteSessionById
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
        this.service.log.info( "stub:DeleteSessionById", { sessionId: this.query?.sessionId } );
        const reply : DeleteSessionById.Response = { ok: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default DeleteSessionByIdImpl;
