//
import { randomUUID } from "node:crypto";

import { SvgDocument, SvgTemplate, StudioProject, Media, GetSvgRenderJob } from "@repo/api";
import { FileUtils, ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

import MediaService from "./MediaService";

//
// SvgService — the server side of the SVG design editor (media Studio). A helper over the shared media plane
// (the owning MediaService's S3 + DynamoDB + SQS facades): the editable SvgDocument.Doc lives as JSON in S3
// (per-account, S3 object versioning is the doc history); DynamoDB holds the project metadata (reusing the
// studio_projects table), the template library (svg-templates), and async export-render job status
// (svg-render-jobs). Never throws — every method returns a Type.Result.
//
export class SvgService
{
    private readonly media : MediaService;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( media : MediaService )
    {
        this.media = media;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── S3 key layouts ────────────────────────────────────────────────────────────────────

    /** The S3 key of a project's editable doc JSON (in the versioned `media` bucket). Static — a pure string
     *  builder that never touches `this.media` — so callers without a MediaService (e.g. SvgRenderPipeline,
     *  which runs from both the MAIN consumer and the Lambda job) can derive the same key without an instance. */
    private static docKey( accountId : string, projectId : string ) : string
    {
        return `svg-docs/${ accountId }/${ projectId }.json`;
    }

    /** The public S3 key of a project's doc (for callers that report it back to the client). */
    public static canvasKey( accountId : string, projectId : string ) : string
    {
        return SvgService.docKey( accountId, projectId );
    }

    /** The S3 key of a template's doc JSON. `owner` is "system" for platform templates, else the accountId. */
    private templateKey( owner : string, templateId : string ) : string
    {
        return `svg-templates/${ owner }/${ templateId }.json`;
    }

    /** The partition value under which a template row is stored — the reserved "system" partition for
     *  platform templates, else the owning accountId (keeps account templates tenant-isolated). */
    private templateOwner( scope : SvgTemplate.TemplateScope, accountId : string ) : string
    {
        return scope === SvgTemplate.TemplateScope.SYSTEM ? SvgService.SYSTEM_OWNER : accountId;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Canvas load / save (S3-backed doc) ──────────────────────────────────────────────

    /** Read a project's SvgDocument.Doc from S3 (err when missing / unparseable). */
    public async getCanvas( projectId : string, accountId : string ) : Promise<Type.Result<SvgDocument.Doc>>
    {
        // fetch the JSON object, then decode + parse it into the typed doc
        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.media.s3.get( "media", SvgService.docKey( accountId, projectId ) );
        if( !object.ok || !object.data.Body ) return ResultUtils.err( "canvas not found" );

        const bytes : Uint8Array = await object.data.Body.transformToByteArray();
        const json : string = new TextDecoder().decode( bytes );
        const parsed : Type.Result<SvgDocument.Doc> = ResultUtils.attempt( () : SvgDocument.Doc => JSON.parse( json ) as SvgDocument.Doc );
        return parsed;
    }

    /** Write a project's SvgDocument.Doc to S3 (a new S3 object version each write) and bump the project's
     *  updatedAt (best-effort). Returns the canvas S3 key + the ISO save timestamp. */
    public async putCanvas( projectId : string, accountId : string, doc : SvgDocument.Doc ) : Promise<Type.Result<{ canvasKey : string; savedAt : string }>>
    {
        const canvasKey : string = SvgService.docKey( accountId, projectId );

        // persist the doc JSON to S3 (versioned bucket → automatic history)
        const wrote : Type.Result<void> = await this.media.s3.put( "media", canvasKey, Buffer.from( JSON.stringify( doc ), "utf8" ), FileUtils.Mime.JSON );
        if( !wrote.ok ) return ResultUtils.err( "could not write the canvas", wrote.cause );

        // bump the project's updatedAt so the list reflects the edit (best-effort — a missing/failed row is
        // not fatal to the save that already landed in S3)
        const savedAt : string = new Date().toISOString();
        const project : StudioProject.Entity | undefined = await this.media.getStudioProject( accountId, projectId );
        if( project !== undefined )
        {
            const stamped : Type.Result<void> = await this.media.putStudioProject( { ...project, modifiedAt: savedAt } );
            if( !stamped.ok ) this.media.log.warn( "svg putCanvas: updatedAt bump failed", { projectId, error: stamped.error } );
        }

        return ResultUtils.ok( { canvasKey, savedAt } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Templates ───────────────────────────────────────────────────────────────────────

    /** List the system templates + the account's own, newest first, optionally filtered by category. */
    public async getTemplates( accountId : string, category : SvgTemplate.Category | null ) : Promise<Type.Result<Array<SvgTemplate.Summary>>>
    {
        // query the two partitions (platform + this account) independently, then merge
        const system : Type.Result<Array<SvgTemplate.Entity>> = await this.media.dynamo.query<SvgTemplate.Entity>( "svg-templates", {
            KeyConditionExpression:    "#owner = :owner",
            ExpressionAttributeNames:  { "#owner": "owner" },
            ExpressionAttributeValues: { ":owner": SvgService.SYSTEM_OWNER },
        } );
        const account : Type.Result<Array<SvgTemplate.Entity>> = await this.media.dynamo.query<SvgTemplate.Entity>( "svg-templates", {
            KeyConditionExpression:    "#owner = :owner",
            ExpressionAttributeNames:  { "#owner": "owner" },
            ExpressionAttributeValues: { ":owner": accountId },
        } );

        // merge (system rows may legitimately be empty), filter by category, sort newest-first, project to Summary
        const merged : Array<SvgTemplate.Entity> = [ ...( system.ok ? system.data : [] ), ...( account.ok ? account.data : [] ) ];
        const filtered : Array<SvgTemplate.Entity> = category === null
            ? merged
            : merged.filter( ( entity : SvgTemplate.Entity ) : boolean => entity.category === category );
        const summaries : Array<SvgTemplate.Summary> = filtered
            .sort( ( first : SvgTemplate.Entity, second : SvgTemplate.Entity ) : number => second.updatedAt - first.updatedAt )
            .map( ( entity : SvgTemplate.Entity ) : SvgTemplate.Summary => this.toSummary( entity ) );
        return ResultUtils.ok( summaries );
    }

    /** Project a stored template Entity to its list Summary (drops the S3 doc key). */
    private toSummary( entity : SvgTemplate.Entity ) : SvgTemplate.Summary
    {
        return {
            id: entity.id, scope: entity.scope, accountId: entity.accountId, name: entity.name,
            category: entity.category, thumbnailKey: entity.thumbnailKey, tags: entity.tags,
            createdAt: entity.createdAt, updatedAt: entity.updatedAt,
        };
    }

    /** Locate a template by id — it is either a system template or one owned by this account. */
    private async findTemplate( templateId : string, accountId : string ) : Promise<SvgTemplate.Entity | undefined>
    {
        // the account's own template takes precedence, then the platform set
        const owned : Type.Result<SvgTemplate.Entity | undefined> = await this.media.dynamo.get<SvgTemplate.Entity>( "svg-templates", { owner: accountId, id: templateId } );
        if( owned.ok && owned.data !== undefined ) return owned.data;
        const system : Type.Result<SvgTemplate.Entity | undefined> = await this.media.dynamo.get<SvgTemplate.Entity>( "svg-templates", { owner: SvgService.SYSTEM_OWNER, id: templateId } );
        return system.ok ? system.data : undefined;
    }

    /** Create a new project from a template — copy the template's S3 doc to a fresh project key (re-id'd),
     *  then create the studio_projects metadata row. The template is never modified. */
    public async createFromTemplate( templateId : string, accountId : string, name : string ) : Promise<Type.Result<{ projectId : string }>>
    {
        // resolve the template + load its doc JSON
        const template : SvgTemplate.Entity | undefined = await this.findTemplate( templateId, accountId );
        if( template === undefined ) return ResultUtils.err( "template not found" );

        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.media.s3.get( "media", template.canvasKey );
        if( !object.ok || !object.data.Body ) return ResultUtils.err( "template doc not found" );
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();
        const source : Type.Result<SvgDocument.Doc> = ResultUtils.attempt( () : SvgDocument.Doc => JSON.parse( new TextDecoder().decode( bytes ) ) as SvgDocument.Doc );
        if( !source.ok ) return ResultUtils.err( "template doc unparseable", source.cause );

        // re-id the copied doc to the new project and write it to the project's S3 key
        const projectId : string = randomUUID();
        const copy : SvgDocument.Doc = { ...source.data, id: projectId };
        const wrote : Type.Result<void> = await this.media.s3.put( "media", SvgService.docKey( accountId, projectId ), Buffer.from( JSON.stringify( copy ), "utf8" ), FileUtils.Mime.JSON );
        if( !wrote.ok ) return ResultUtils.err( "could not write the new project doc", wrote.cause );

        // create the project metadata row (reuses studio_projects; kind IMAGE — SVG projects are page designs)
        const created : Type.Result<void> = await this.createProjectRow( accountId, projectId, name );
        if( !created.ok ) return ResultUtils.err( "could not create the project", created.cause );

        return ResultUtils.ok( { projectId } );
    }

    /** Save an existing project as an ACCOUNT-scoped template — copy its S3 doc to the templates prefix and
     *  create the svg-templates row. */
    public async saveAsTemplate( projectId : string, accountId : string, name : string, category : SvgTemplate.Category, tags : Array<string> ) : Promise<Type.Result<{ templateId : string }>>
    {
        // load the project's current doc
        const doc : Type.Result<SvgDocument.Doc> = await this.getCanvas( projectId, accountId );
        if( !doc.ok ) return ResultUtils.err( "project doc not found", doc.cause );

        // write the doc copy under the account's template prefix
        const templateId : string = randomUUID();
        const owner : string = this.templateOwner( SvgTemplate.TemplateScope.ACCOUNT, accountId );
        const canvasKey : string = this.templateKey( owner, templateId );
        const wrote : Type.Result<void> = await this.media.s3.put( "media", canvasKey, Buffer.from( JSON.stringify( doc.data ), "utf8" ), FileUtils.Mime.JSON );
        if( !wrote.ok ) return ResultUtils.err( "could not write the template doc", wrote.cause );

        // create the template row (thumbnail regeneration is a later phase — key reserved, no PNG yet)
        const now : number = Date.now();
        const entity : SvgTemplate.Entity & { owner : string } =
        {
            owner, id: templateId, scope: SvgTemplate.TemplateScope.ACCOUNT, accountId, name,
            category, canvasKey, thumbnailKey: `svg-templates/${ owner }/${ templateId }.thumb.png`,
            tags, createdAt: now, updatedAt: now,
        };
        const row : Type.Result<void> = await this.media.dynamo.put( "svg-templates", { ...entity } );
        if( !row.ok ) return ResultUtils.err( "could not create the template", row.cause );

        return ResultUtils.ok( { templateId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Export render jobs (async) ───────────────────────────────────────────────────────

    /** Enqueue an export render job — record it PENDING, then hand the work to the render queue (a consumer
     *  does the Puppeteer render and flips the row to DONE/FAILED). Returns the jobId to poll. */
    public async queueRenderJob( projectId : string, accountId : string, pageIds : Array<string> | null, settings : SvgDocument.ExportSettings ) : Promise<Type.Result<{ jobId : string }>>
    {
        // record the job PENDING so a poll immediately after enqueue sees a status
        const jobId : string = randomUUID();
        const row : SvgService.RenderJobRow =
        {
            pk: jobId, accountId, projectId, status: GetSvgRenderJob.RenderStatus.PENDING,
            outputUrl: null, error: null, createdAt: new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.media.dynamo.put( "svg-render-jobs", { ...row } );
        if( !wrote.ok ) return ResultUtils.err( "could not record the render job", wrote.cause );

        // enqueue the heavy work (validate → enqueue → return; the consumer renders + uploads + flips status)
        const queued : Type.Result<void> = await this.media.sqs.send( "svg-render", { jobId, accountId, projectId, pageIds, settings } );
        if( !queued.ok ) return ResultUtils.err( "could not queue the render job", queued.cause );

        return ResultUtils.ok( { jobId } );
    }

    /** Read a render job's status (tenant-scoped — a job belonging to another account reads as not found). */
    public async getRenderJob( jobId : string, accountId : string ) : Promise<Type.Result<{ status : GetSvgRenderJob.RenderStatus; outputUrl : string | null; error : string | null }>>
    {
        const got : Type.Result<SvgService.RenderJobRow | undefined> = await this.media.dynamo.get<SvgService.RenderJobRow>( "svg-render-jobs", { pk: jobId } );
        if( !got.ok ) return ResultUtils.err( "could not read the render job", got.cause );
        if( got.data === undefined || got.data.accountId !== accountId ) return ResultUtils.err( "render job not found" );

        // a stored job carrying a presigned outputUrl is served as-is; a completed job with an S3 key would be
        // (re)presigned here in a later phase — MVP writes the URL directly on completion
        return ResultUtils.ok( { status: got.data.status, outputUrl: got.data.outputUrl, error: got.data.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Project metadata row ──────────────────────────────────────────────────────────────

    /** Create the studio_projects metadata row for an SVG project (kind IMAGE — a page design). */
    public async createProjectRow( accountId : string, projectId : string, name : string ) : Promise<Type.Result<void>>
    {
        const now : string = new Date().toISOString();
        const project : StudioProject.Entity =
        {
            accountId, id: projectId, name: name.trim(), kind: Media.Kind.IMAGE, tags: [],
            page: { ...StudioProject.DEFAULT_PAGE }, createdAt: now, modifiedAt: now,
        };
        return this.media.putStudioProject( project );
    }
}

export namespace SvgService
{
    /** The reserved DynamoDB partition value for platform (system) templates. */
    export const SYSTEM_OWNER : string = "__system__";

    /** A render-job status row (svg-render-jobs table; pk = jobId). */
    export interface RenderJobRow
    {
        pk        : string;                         // jobId (partition key)
        accountId : string;
        projectId : string;
        status    : GetSvgRenderJob.RenderStatus;
        outputUrl : string | null;                  // presigned download URL once DONE
        error     : string | null;
        createdAt : string;
    }
}

export default SvgService;
// eof
