//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Render a VIDEO Studio project's timeline to an mp4 and save it to the library (create first time, then
// update the same asset in place — like the image editor's Save to Library). HEAVY + async: the endpoint
// validates + enqueues a render job and returns 202; a media Job composites the scenes with ffmpeg, uploads
// the mp4, links it to the project, and emits `media.job` progress events. The client polls / listens.
export class PostStudioRender extends RestfulEndpoint<PostStudioRender.Query, PostStudioRender.Body, PostStudioRender.Response>
{
    public readonly uri      : string = PostStudioRender.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostStudioRender
{
    export const URI : string = apiPath( "media", 1, "/projects/:id/render" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { queued : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostStudioRender;
