//
import { PostStudioRender, StudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// Enqueue a video project render → mp4 saved to the library. Validates the project exists, then enqueues the
// render Job and returns 202 (the Job composites with ffmpeg + emits media.job progress).
//
export class PostStudioRenderImpl extends PostStudioRender
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostStudioRenderImpl", { userId: auth.userId, accountId: auth.accountId, id: this.query?.id } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const project : StudioProject.Entity | undefined = await this.service.getStudioProject( auth.accountId, id );
        if( project === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "project not found" } };

        const queued : Type.Result<void> = await this.service.enqueueStudioRender( auth.accountId, id, auth.userId );
        if( !queued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not queue the render" } };

        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true } };
    }
}

export default PostStudioRenderImpl;
