//
import { DeleteApiKey } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/services';
import type { Type } from '@repo/common';
import AuthService from '../services/AuthService';

//
// Revoke a developer API key (by keyId) belonging to the acting account. Sets status = revoked; 404 if the key
// isn't found under this account. The row is kept for audit until its TTL.
//
export class DeleteApiKeyImpl extends DeleteApiKey
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "account context required" } };

        const keyId : string = this.query?.keyId ?? "";
        if( !keyId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "keyId is required" } };

        // revoke through the store — ownership is checked there (returns false if not this account's key)
        const revoked : Type.Result<boolean> = await this.service.apiKeys.revoke( auth.accountId, keyId );
        if( !revoked.ok )
        {
            this.service.log.error( "DeleteApiKey", revoked.error );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
        if( !revoked.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "api key not found" } };

        // broadcast the CRUD delete (best-effort)
        void this.service.emit( Events.Object.AUTH_APIKEY, Events.Verb.DELETED, "apikey", keyId, auth.accountId, { keyId }, auth.userId );

        const reply : DeleteApiKey.Response = { revoked: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default DeleteApiKeyImpl;
