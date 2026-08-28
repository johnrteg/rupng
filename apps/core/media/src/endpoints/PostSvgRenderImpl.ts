//
import { PostSvgRender } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// Trigger an async export render — enqueue the job (validate → enqueue → return fast) and hand back the jobId
// the client polls via GetSvgRenderJob.
export class PostSvgRenderImpl extends PostSvgRender
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostSvgRenderImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostSvgRender.Body | null = this.body;
        if( !body || !body.projectId || !body.settings ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "projectId and settings required" } };

        const queued : Type.Result<{ jobId : string }> = await this.svg.queueRenderJob( body.projectId, auth.accountId, body.pageIds ?? null, body.settings );
        if( !queued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not start the render" } };

        return { status: NetworkUtils.Status.OK, data: { jobId: queued.data.jobId } };
    }
}

export default PostSvgRenderImpl;
