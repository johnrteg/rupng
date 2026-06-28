//
import { PostSessionSwitch } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// STUB — switch the acting account/role. Echoes the requested target.
// TODO: validate the target against the account-owned max role (read account membership), clamp if it
//       exceeds the ceiling, mint a new acting context (re-stamped token), step-up if required.
//
export class PostSessionSwitchImpl extends PostSessionSwitch
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
        this.service.log.info( "stub:PostSessionSwitch", { accountId: this.body?.accountId, role: this.body?.role } );
        const reply : PostSessionSwitch.Response = { accountId: this.body!.accountId, role: this.body?.role ?? "user", clamped: false };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostSessionSwitchImpl;
