//
import { PostApiKey, ApiKey } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Events } from '@repo/services';
import type { Type } from '@repo/common';
import AuthService from '../services/AuthService';

//
// Mint a developer API key for the acting account. The requested `role` is CAPPED at the caller's resolved role
// (a user can't create a key more powerful than themselves — enforced in the store via Access.isAllowed).
// Returns the key view PLUS the full one-time secret `rup_<keyId>.<secret>` — shown ONCE; only its hash is stored.
//
export class PostApiKeyImpl extends PostApiKey
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "account context required" } };

        // normalize the request body + the caller's resolved role (the mint cap)
        const name          : string = ( this.body?.name ?? "" ).trim();
        const requestedRole : Access.Role = this.body?.role ?? Access.AccountRole.MINIMUM;
        const callerRole    : Access.Role = ( auth.role as Access.Role ) ?? Access.AccountRole.MINIMUM;
        if( !name ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name is required" } };

        // mint through the store — it enforces the role cap and stores only the secret's hash
        const minted : Type.Result<{ view : ApiKey.View; secret : string }> = await this.service.apiKeys.mint( {
            accountId: auth.accountId, userId: auth.userId, callerRole,
            name, role: requestedRole, tier: this.body?.tier, expiresInDays: this.body?.expiresInDays,
        } );
        if( !minted.ok )
        {
            // a role-cap rejection is a client error (403); anything else is a data-layer failure (500)
            const isRoleCap : boolean = minted.error.includes( "role" );
            this.service.log.error( "PostApiKey", minted.error );
            return isRoleCap
                ? { status: NetworkUtils.Status.FORBIDDEN, data: { message: minted.error } }
                : { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }

        // broadcast the CRUD create (best-effort; the secret is NEVER put on the bus)
        void this.service.emit( Events.Object.AUTH_APIKEY, Events.Verb.CREATED, "apikey", minted.data.view.keyId, auth.accountId, minted.data.view, auth.userId );

        const reply : PostApiKey.Response = { key: minted.data.view, secret: minted.data.secret };
        return { status: NetworkUtils.Status.CREATED, data: reply };
    }
}

export default PostApiKeyImpl;
