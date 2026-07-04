//
import { GetItemVersions, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { S3 } from '@repo/services';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// List the S3 version history of one item in an envelope (media-1.4) — newest first — so the user can review
// prior versions and revert (PostItemRevert). Resolves the item by its key (`usage[.profile]`, default the
// ORIGINAL), then hands back S3's version metadata mapped to the wire model.
//
export class GetItemVersionsImpl extends GetItemVersions
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        // resolve the target item — the requested item key, else the ORIGINAL
        const wanted : string = this.query?.item ?? "";
        const item : Media.Item | undefined = ( !wanted || wanted === "original" )
            ? Media.originalItem( asset )
            : ( asset.items ?? [] ).find( ( candidate ) => Media.itemKey( candidate.usage, candidate.profile ) === wanted );
        if( !item ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "item not found" } };

        const listed : Type.Result<Array<S3.Version>> = await this.service.s3.listVersions( "media", MediaPipeline.itemKey( asset, item ) );
        if( !listed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list versions" } };

        // S3.Version → wire Media.ItemVersion (shapes align; mapped explicitly to keep the wire model stable)
        const versions : Array<Media.ItemVersion> = listed.data.map( ( version ) : Media.ItemVersion => ( {
            versionId: version.versionId, size: version.size, lastModified: version.lastModified, isLatest: version.isLatest,
        } ) );
        return { status: NetworkUtils.Status.OK, data: { versions } };
    }
}

export default GetItemVersionsImpl;
