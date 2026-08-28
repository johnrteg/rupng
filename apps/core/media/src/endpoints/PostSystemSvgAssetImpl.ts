//
import { PostSystemSvgAsset, SvgAsset } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgAssetService from '../services/SvgAssetService';

// Add an SVG graphic to the platform-wide (SYSTEM) library — root/platform-admin only (enforced by this
// endpoint's declared `access = Access.AppRole.ROOT`, not a runtime check here).
export class PostSystemSvgAssetImpl extends PostSystemSvgAsset
{
    private service : MediaService;
    private svgAssets : SvgAssetService;
    constructor( service : MediaService ) { super(); this.service = service; this.svgAssets = new SvgAssetService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostSystemSvgAssetImpl", { userId: auth.userId } );
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostSystemSvgAsset.Body | null = this.body;
        if( !body || !body.name ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name required" } };
        if( !body.svg && !( body.provider && body.externalId ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "svg, or provider + externalId, required" } };

        // system-wide rows aren't account-scoped; the accountId argument here only shapes the (unused) owner
        // branch of SvgAssetService.create when system=true, so any non-empty placeholder is fine
        const created : Type.Result<{ assetId : string; svg : string }> = await this.svgAssets.create( "system", true, body );
        if( !created.ok && SvgAsset.isQuarantineRejection( created.cause ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: created.error, reasons: created.cause.reasons } };
        if( !created.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: created.error } };

        return { status: NetworkUtils.Status.OK, data: { assetId: created.data.assetId, svg: created.data.svg } };
    }
}

export default PostSystemSvgAssetImpl;
