//
import { DeleteConnection, SocialAccount } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import SocialService from "../services/SocialService";

//
// Disconnect a destination — revokes + removes the marketplace installation, then removes the
// connection row (hard-deleted here; the marketplace installation itself is the audited record).
//
export class DeleteConnectionImpl extends DeleteConnection
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id )            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<SocialAccount.Entity | undefined> = await this.service.dynamo.get<SocialAccount.Entity>( "connections", { accountId, id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connection read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "connection not found" } };

        const revoked : Type.Result<unknown> = await this.service.disconnectMarketplace( got.data.marketplaceInstallationId );
        if( !revoked.ok ) this.service.log.warn( "marketplace disconnect failed (removing connection anyway)", { id, error: revoked.error } );

        const removed : Type.Result<void> = await this.service.dynamo.remove( "connections", { accountId, id } );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connection removal failed" } };

        await this.service.emitAccountEvent( Events.Verb.DELETED, got.data );

        return { status: NetworkUtils.Status.OK, data: { id, disconnected: true } };
    }
}

export default DeleteConnectionImpl;
