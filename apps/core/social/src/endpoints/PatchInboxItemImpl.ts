//
import { PatchInboxItem, SocialInbound } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Set/clear tags or flip open/handled on an inbound item.
//
export class PatchInboxItemImpl extends PatchInboxItem
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

        const got : Type.Result<SocialInbound.Entity | undefined> = await this.service.dynamo.get<SocialInbound.Entity>( "inbox", { accountId, id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "inbox item read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "inbox item not found" } };

        const updated : SocialInbound.Entity = {
            ...got.data,
            tags:   this.body?.tags ?? got.data.tags,
            status: this.body?.status ?? got.data.status,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "inbox", { ...updated } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "inbox item write failed" } };

        return { status: NetworkUtils.Status.OK, data: updated };
    }
}

export default PatchInboxItemImpl;
