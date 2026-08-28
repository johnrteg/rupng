//
import { GetSvgAssets, SvgAsset } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgAssetService from '../services/SvgAssetService';

// List the system SVG library + the account's own (summaries only).
export class GetSvgAssetsImpl extends GetSvgAssets
{
    private service : MediaService;
    private svgAssets : SvgAssetService;
    constructor( service : MediaService ) { super(); this.service = service; this.svgAssets = new SvgAssetService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetSvgAssetsImpl", { accountId: auth.accountId } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const got : Type.Result<Array<SvgAsset.Summary>> = await this.svgAssets.list( auth.accountId );
        if( !got.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list SVG assets" } };

        return { status: NetworkUtils.Status.OK, data: { assets: got.data } };
    }
}

export default GetSvgAssetsImpl;
