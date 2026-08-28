//
import { PatchAsset, Media } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Update editable metadata (tags / display name).
export class PatchAssetImpl extends PatchAsset
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PatchAssetImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const current : Media.Asset = ObjectUtils.withDefaults( got.data, Media.DEFAULT );
        const asset : Media.Asset = {
            ...current,
            tags:        this.body?.tags !== undefined ? this.body.tags : current.tags,
            name:        this.body?.name !== undefined ? this.body.name : current.name,
            campaignIds: this.body?.campaignIds !== undefined ? this.body.campaignIds : current.campaignIds,   // 0..N campaigns using this asset
            modifiedAt:  new Date().toISOString(),
        };
        const put : Type.Result<void> = await this.service.dynamo.put( "media", { ...asset } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        void this.service.assetUpdated( asset, auth.userId );   // media.asset updated (best-effort)
        return { status: NetworkUtils.Status.OK, data: { asset } };
    }
}

export default PatchAssetImpl;
