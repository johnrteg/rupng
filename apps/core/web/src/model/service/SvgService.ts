//
import { GetSvgCanvas, PutSvgCanvas, GetSvgTemplates, PostSvgFromTemplate, PostSvgRender, GetSvgRenderJob, SvgDocument, SvgTemplate } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import AppModel from "../AppModel";

//
// SvgService (web) — the client wrapper over the SVG editor's server endpoints. Mirrors the house service
// pattern (AccountService): every call goes through `appmodel.server.fetch` and returns the RestfulService
// Reply (a Result) — the caller branches on `reply.ok`, this layer never throws. Owns no state.
//
export class SvgService
{
    private appmodel : AppModel;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appmodel = app;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Load a project's editable SvgDocument.Doc (+ its S3 key) from the server. */
    public getCanvas( projectId : string ) : Promise<RestfulService.Reply<GetSvgCanvas.Response>>
    {
        return this.appmodel.server.fetch( new GetSvgCanvas( projectId ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Save a project's SvgDocument.Doc to the server (behind the editor's debounced autosave + manual Save). */
    public putCanvas( projectId : string, doc : SvgDocument.Doc ) : Promise<RestfulService.Reply<PutSvgCanvas.Response>>
    {
        return this.appmodel.server.fetch( new PutSvgCanvas( { projectId, doc } ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** List the template gallery (system + this account's), optionally filtered by category. */
    public getTemplates( category : SvgTemplate.Category | null ) : Promise<RestfulService.Reply<GetSvgTemplates.Response>>
    {
        return this.appmodel.server.fetch( new GetSvgTemplates( category ?? undefined ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Create a new project from a template — returns the new projectId. */
    public createFromTemplate( templateId : string, name : string ) : Promise<RestfulService.Reply<PostSvgFromTemplate.Response>>
    {
        return this.appmodel.server.fetch( new PostSvgFromTemplate( templateId, { name } ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Trigger an async export render (all pages) — returns the jobId to poll. */
    public render( projectId : string, settings : SvgDocument.ExportSettings ) : Promise<RestfulService.Reply<PostSvgRender.Response>>
    {
        return this.appmodel.server.fetch( new PostSvgRender( { projectId, pageIds: null, settings } ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Poll a render job's status (until DONE / FAILED). */
    public getRenderJob( jobId : string ) : Promise<RestfulService.Reply<GetSvgRenderJob.Response>>
    {
        return this.appmodel.server.fetch( new GetSvgRenderJob( jobId ) );
    }
}

export default SvgService;
