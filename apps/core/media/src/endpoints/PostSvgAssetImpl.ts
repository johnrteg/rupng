//
import { PostSvgAsset, SvgAsset } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgAssetService from '../services/SvgAssetService';

// Add an SVG graphic to the acting account's own library — raw markup or a Browse provider pick.
export class PostSvgAssetImpl extends PostSvgAsset
{
    private service : MediaService;
    private svgAssets : SvgAssetService;
    constructor( service : MediaService ) { super(); this.service = service; this.svgAssets = new SvgAssetService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostSvgAssetImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostSvgAsset.Body | null = this.body;
        if( !body || !body.name ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name required" } };
        if( !body.svg && !( body.provider && body.externalId ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "svg, or provider + externalId, required" } };

        const created : Type.Result<{ assetId : string; svg : string }> = await this.svgAssets.create( auth.accountId, false, body );
        if( !created.ok && SvgAsset.isQuarantineRejection( created.cause ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: created.error, reasons: created.cause.reasons } };
        if( !created.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: created.error } };

        return { status: NetworkUtils.Status.OK, data: { assetId: created.data.assetId, svg: created.data.svg } };
    }
}

export default PostSvgAssetImpl;
