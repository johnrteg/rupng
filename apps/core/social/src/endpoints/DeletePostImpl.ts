//
import { DeletePost, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import SocialService from "../services/SocialService";

//
// Cancel a scheduled (unpublished) post — status → CANCELED. A published post cannot be canceled.
//
export class DeletePostImpl extends DeletePost
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

        const got : Type.Result<SocialPost.Entity | undefined> = await this.service.dynamo.get<SocialPost.Entity>( "posts", { accountId, id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "post read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "post not found" } };
        if( got.data.status === SocialPost.Status.PUBLISHED )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "post already published" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const canceled : SocialPost.Entity = { ...got.data, status: SocialPost.Status.CANCELED, modifiedAt: now };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "posts", { ...canceled } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "post cancel failed" } };

        await this.service.emitPostEvent( Events.Verb.UPDATED, canceled );

        return { status: NetworkUtils.Status.OK, data: { id, canceled: true } };
    }
}

export default DeletePostImpl;
