//
import { PostItemText, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// Overwrite a text item's content (media-18) — the caption editor's Save. Resolves the item by its key
// (`usage[.profile]`), writes the new text to its S3 key (S3 versioning keeps the prior text, so an edit is
// revertable), bumps the item's `version` + size, and returns the updated envelope.
//
export class PostItemTextImpl extends PostItemText
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostItemTextImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        const wantedItem : string = this.body?.item ?? "";
        const text : string = this.body?.text ?? "";
        if( !guid || !wantedItem ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid and item required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        const item : Media.Item | undefined = ( asset.items ?? [] ).find( ( candidate ) => Media.itemKey( candidate.usage, candidate.profile ) === wantedItem );
        if( !item ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "item not found" } };

        // write the new text to the item's key (a new S3 version) + bump the item version/size
        const body : Buffer = Buffer.from( text );
        const put : Type.Result<void> = await this.service.s3.put( "media", MediaPipeline.itemKey( asset, item ), body, item.mime );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the text" } };

        const now : string = new Date().toISOString();
        const edited : Media.Item = { ...item, size: body.length, version: item.version + 1, modifiedAt: now };
        const updated : Media.Asset = { ...asset, items: Media.upsertItems( asset.items, edited ), modifiedAt: now };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "media", { ...updated } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        void this.service.assetUpdated( updated, auth.userId );   // media.asset updated (best-effort)
        return { status: NetworkUtils.Status.OK, data: { asset: updated } };
    }
}

export default PostItemTextImpl;
