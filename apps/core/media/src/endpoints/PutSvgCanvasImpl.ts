//
import { PutSvgCanvas, SvgDocument } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// Save a project's SvgDocument.Doc to S3 (new S3 version each write) + bump the project's updatedAt. Rejects a
// doc whose schemaVersion doesn't match the server's current schema (a shape the server can't safely store).
export class PutSvgCanvasImpl extends PutSvgCanvas
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PutSvgCanvas.Body | null = this.body;
        if( !body || !body.projectId || !body.doc ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "projectId and doc required" } };
        if( body.doc.schemaVersion !== SvgDocument.SCHEMA_VERSION ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "unsupported doc schemaVersion" } };

        const saved : Type.Result<{ canvasKey : string; savedAt : string }> = await this.svg.putCanvas( body.projectId, auth.accountId, body.doc );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the canvas" } };

        return { status: NetworkUtils.Status.OK, data: { savedAt: saved.data.savedAt } };
    }
}

export default PutSvgCanvasImpl;
