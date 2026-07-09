//
import { GetAssets, Media, Paging } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// The media library view — list the acting account's assets (media-1.2), filtered by scope / scopeId / kind /
// status. Soft-deleted rows are excluded unless explicitly asked for.
//
export class GetAssetsImpl extends GetAssets
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Media.Asset>> = await this.service.dynamo.query<Media.Asset>( "media", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };

        const q : GetAssets.Query = this.query ?? {};
        const assets : Array<Media.Asset> = found.data
            .map( ( row ) => ObjectUtils.withDefaults( row, Media.DEFAULT ) )
            .filter( ( a : Media.Asset ) =>
                ( q.status ? a.status === q.status : a.status !== Media.Status.DELETED )   // hide soft-deleted unless asked
                && ( !q.scope      || a.scope   === q.scope )
                && ( !q.scopeId    || a.scopeId === q.scopeId )
                && ( !q.kind       || a.kind    === q.kind )
                && ( !q.campaignId || ( a.campaignIds ?? [] ).includes( q.campaignId ) ) )   // campaign = filter, not ownership
            .sort( ( a, b ) => String( b.createdAt ?? "" ).localeCompare( String( a.createdAt ?? "" ) ) );   // newest first

        const paged : Paging.Result<Media.Asset> = Paging.paginate( assets, q );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetAssetsImpl;
