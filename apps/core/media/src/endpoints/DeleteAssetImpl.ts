//
import { DeleteAsset, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Soft-delete (status DELETED + deletedAt); a lifecycle sweep purges the S3 bytes later (media-1.4).
export class DeleteAssetImpl extends DeleteAsset
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: DeleteAssetImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        // an asset used by one or more campaigns can't be deleted until it's released (the campaign is
        // hard-deleted / detaches it). `campaignIds` is the denormalized usage set (SoT = campaign).
        const campaignIds : Array<string> = got.data.campaignIds ?? [];
        if( campaignIds.length > 0 )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: `in use by ${ campaignIds.length } campaign(s) — remove it from those campaigns first` } };

        const now : string = new Date().toISOString();
        const deleted : Media.Asset = { ...got.data, status: Media.Status.DELETED, deletedAt: now, modifiedAt: now };
        const put = await this.service.dynamo.put( "media", { ...deleted } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        void this.service.assetDeleted( deleted, auth.userId );   // media.asset deleted (best-effort)
        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteAssetImpl;
