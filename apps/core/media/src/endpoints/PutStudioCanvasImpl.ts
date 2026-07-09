//
import { PutStudioCanvas, StudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Save a project's canvas snapshot to S3 and re-stamp the project's modified fields (the low-cadence server
// sync behind the editor's instant localStorage autosave).
export class PutStudioCanvasImpl extends PutStudioCanvas
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const body : PutStudioCanvas.Body | null = this.body;
        if( !body || body.canvas === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "canvas required" } };

        const project : StudioProject.Entity | undefined = await this.service.getStudioProject( auth.accountId, id );
        if( project === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "project not found" } };

        // write the snapshot to S3, then bump the project's modified metadata
        const wrote : Type.Result<void> = await this.service.putStudioCanvas( auth.accountId, id, body.canvas );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the canvas" } };

        const savedAt : string = new Date().toISOString();
        const stamped : Type.Result<void> = await this.service.putStudioProject( { ...project, modifiedAt: savedAt, modifiedBy: auth.userId } );
        if( !stamped.ok ) { /* canvas saved; the modified-stamp bump is best-effort */ }

        return { status: NetworkUtils.Status.OK, data: { savedAt } };
    }
}

export default PutStudioCanvasImpl;
