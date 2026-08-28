//
import { PostItemRevert, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// Revert an item to a prior S3 version (media-1.4): copy the chosen version back onto the current key (which
// writes a NEW latest version — nothing is destroyed), then bump the item's `version` and record the new
// current `versionId`. Returns the updated envelope. (An item's PROBED meta is left as-is; a re-probe on the
// reverted bytes is a follow-up.)
//
export class PostItemRevertImpl extends PostItemRevert
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostItemRevertImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };
        const wantedItem : string = this.body?.item ?? "";
        const versionId  : string = this.body?.versionId ?? "";
        if( !wantedItem || !versionId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "item and versionId required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        const target : string = wantedItem === "original" ? Media.Usage.ORIGINAL : wantedItem;
        const item : Media.Item | undefined = ( asset.items ?? [] ).find( ( candidate ) => Media.itemKey( candidate.usage, candidate.profile ) === target );
        if( !item ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "item not found" } };

        // copy the chosen version back onto the current key → a new latest version (old bytes stay in history)
        const restored : Type.Result<string | undefined> = await this.service.s3.restoreVersion( "media", MediaPipeline.itemKey( asset, item ), versionId );
        if( !restored.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not revert the version" } };

        // bump the item's version + record the new current S3 versionId
        const now : string = new Date().toISOString();
        const reverted : Media.Item = { ...item, version: item.version + 1, versionId: restored.data, modifiedAt: now };
        const updated : Media.Asset = { ...asset, items: Media.upsertItems( asset.items, reverted ), modifiedAt: now };
        const put : Type.Result<void> = await this.service.dynamo.put( "media", { ...updated } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        void this.service.assetUpdated( updated, auth.userId );   // media.asset updated (best-effort)
        return { status: NetworkUtils.Status.OK, data: { asset: updated } };
    }
}

export default PostItemRevertImpl;
