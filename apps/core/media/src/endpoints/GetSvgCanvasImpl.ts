//
import { GetSvgCanvas, SvgDocument } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// Load a project's SvgDocument.Doc (S3-backed) + the S3 key it lives at. 404 when the doc doesn't exist yet.
export class GetSvgCanvasImpl extends GetSvgCanvas
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const projectId : string = this.query?.projectId ?? "";
        if( !projectId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "projectId required" } };

        const got : Type.Result<SvgDocument.Doc> = await this.svg.getCanvas( projectId, auth.accountId );
        if( !got.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "canvas not found" } };

        const canvasKey : string = this.svg.canvasKey( auth.accountId, projectId );
        return { status: NetworkUtils.Status.OK, data: { doc: got.data, canvasKey } };
    }
}

export default GetSvgCanvasImpl;
