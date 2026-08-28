//
import { GetAsset, Media } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// One asset's index record (filled from the model DEFAULT for schema tolerance).
export class GetAssetImpl extends GetAsset
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetAssetImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        return { status: NetworkUtils.Status.OK, data: { asset: ObjectUtils.withDefaults( got.data, Media.DEFAULT ) } };
    }
}

export default GetAssetImpl;
