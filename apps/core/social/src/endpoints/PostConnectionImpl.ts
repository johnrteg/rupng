//
import { randomUUID } from "node:crypto";

import { PostConnection, SocialAccount } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import SocialService from "../services/SocialService";

//
// Connect a destination — creates the marketplace installation (BYO OAuth) then persists the
// connection record referencing it. Quota enforcement (plan `maxProfiles` per network, 409 over) is a
// follow-on once `SocialConfig` lands; every connect succeeds for now.
//
export class PostConnectionImpl extends PostConnection
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const platform : SocialAccount.Platform | undefined = this.body?.platform;
        if( !platform )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "platform required" } };

        // start the marketplace connect flow BEFORE persisting the connection row — a failed connect
        // means no dangling connection is left behind
        const connected : Type.Result<{ installationId : Type.UUID; connect : { authorizeUrl? : string } }> = await this.service.connectMarketplace(
            accountId, SocialService.integrationIdFor( platform ), auth.userId, this.body?.scopes );
        if( !connected.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "marketplace connect failed" } };

        const id : Type.UUID = randomUUID();
        const now : Type.ISODateTime = new Date().toISOString();
        const entity : SocialAccount.Entity =
        {
            id,
            accountId,
            platform,
            handle:                    this.body?.handle,
            marketplaceInstallationId: connected.data.installationId,
            scopes:                    this.body?.scopes,
            status:                    SocialAccount.ConnectionStatus.CONNECTED,
            createdAt:                 now,
            modifiedAt:                now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "connections", { ...entity } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connection write failed" } };

        await this.service.emitAccountEvent( Events.Verb.CREATED, entity );

        return { status: NetworkUtils.Status.OK, data: { id, platform, status: entity.status, authorizeUrl: connected.data.connect.authorizeUrl } };
    }
}

export default PostConnectionImpl;
