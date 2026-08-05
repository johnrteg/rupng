//
import { DeleteSvgAsset } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgAssetService from '../services/SvgAssetService';

// Delete an SVG asset from the acting account's own library (system-wide assets aren't deletable here).
export class DeleteSvgAssetImpl extends DeleteSvgAsset
{
    private service : MediaService;
    private svgAssets : SvgAssetService;
    constructor( service : MediaService ) { super(); this.service = service; this.svgAssets = new SvgAssetService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const assetId : string = this.query?.assetId ?? "";
        if( !assetId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "assetId required" } };

        const removed : Type.Result<void> = await this.svgAssets.remove( assetId, auth.accountId );
        if( !removed.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: removed.error } };

        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteSvgAssetImpl;
