//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Poll an export render job's status. Returns a presigned download URL once DONE, or an error message on
// FAILED. The client polls this until a terminal status.
export class GetSvgRenderJob extends RestfulEndpoint<GetSvgRenderJob.Query, undefined, GetSvgRenderJob.Response>
{
    public readonly uri      : string = GetSvgRenderJob.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( jobId? : string ) { super( { jobId: jobId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "jobId", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSvgRenderJob
{
    export const URI : string = apiPath( "media", 1, "/svg/render/:jobId" );
    export interface Query { jobId : string; }
    export interface Response
    {
        status    : RenderStatus;
        outputUrl : string | null;           // presigned S3 URL when complete
        error     : string | null;
    }
    export enum RenderStatus { PENDING = "pending", PROCESSING = "processing", DONE = "done", FAILED = "failed" }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetSvgRenderJob;
