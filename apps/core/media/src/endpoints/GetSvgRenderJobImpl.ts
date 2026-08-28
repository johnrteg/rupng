//
import { GetSvgRenderJob } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// Poll an export render job's status (tenant-scoped). 404 when the job doesn't exist / belongs to another account.
export class GetSvgRenderJobImpl extends GetSvgRenderJob
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetSvgRenderJobImpl", { accountId: auth.accountId, jobId: this.query?.jobId } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const jobId : string = this.query?.jobId ?? "";
        if( !jobId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "jobId required" } };

        const got : Type.Result<{ status : GetSvgRenderJob.RenderStatus; outputUrl : string | null; error : string | null }> = await this.svg.getRenderJob( jobId, auth.accountId );
        if( !got.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "render job not found" } };

        return { status: NetworkUtils.Status.OK, data: { status: got.data.status, outputUrl: got.data.outputUrl, error: got.data.error } };
    }
}

export default GetSvgRenderJobImpl;
