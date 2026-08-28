//
import { randomUUID } from "node:crypto";

import { PostInstallation, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { OAuth } from "@repo/oauth";
import MarketplaceService from "../services/MarketplaceService";

//
// S2S: create an Installation row + start its connect flow. The new installation's id doubles as the
// OAuth broker's `connectionKey` (see `@repo/oauth`'s OAuthBroker) — the broker owns token storage, we
// only persist the catalog/lifecycle record.
//
export class PostInstallationImpl extends PostInstallation
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostInstallation.Body | null = this.body;
        if( !body?.accountId || !body.integrationId || !body.installedBy )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, integrationId, and installedBy are required" } };

        const installationId : Type.UUID = randomUUID();
        const now : Type.ISODateTime = new Date().toISOString();
        const entity : Marketplace.Installation =
        {
            installationId,
            accountId:     body.accountId,
            integrationId: body.integrationId,
            instanceId:    body.instanceId,
            label:         body.label,
            status:        Marketplace.InstallStatus.CONFIGURED,
            config:        {},
            health:        { state: Marketplace.HealthState.ERROR },
            installedBy:   body.installedBy,
            installedAt:   now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "installations", { ...entity } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation write failed" } };

        // start the connect flow (OAuth authorize session, or a validated API-key connect) via the broker
        const session : Type.Result<OAuth.ConnectSession> = await this.service.oauthFor( body.integrationId ).startConnect(
            body.integrationId, installationId, { scopes: body.scopes } );
        if( !session.ok )
            return { status: NetworkUtils.Status.OK, data: { installationId, connect: {} } };   // installation exists; connect can be retried

        return { status: NetworkUtils.Status.OK, data: { installationId, connect: { authorizeUrl: session.data.token } } };
    }
}

export default PostInstallationImpl;
