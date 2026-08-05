//
import { GetSvgAsset } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgAssetService from '../services/SvgAssetService';

// Read one SVG library asset's markup (for preview + placement).
export class GetSvgAssetImpl extends GetSvgAsset
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

        const got : Type.Result<{ name : string; svg : string }> = await this.svgAssets.get( assetId, auth.accountId, this.query?.scope );
        if( !got.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: got.error } };

        return { status: NetworkUtils.Status.OK, data: { name: got.data.name, svg: got.data.svg } };
    }
}

export default GetSvgAssetImpl;
