//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Mark a presigned upload as done (the client finished the S3 PUT). Advances UPLOADING → SCANNING and
// enqueues the scan → process pipeline. (In prod an S3-created event also drives this; the endpoint makes
// dev deterministic without relying on bucket notifications.)
export class PostUploadComplete extends RestfulEndpoint<PostUploadComplete.Query, PostUploadComplete.Body, PostUploadComplete.Response>
{
    public readonly uri      : string = PostUploadComplete.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" }, {} ); }   // send an empty body ({}) — a POST with a null body trips the server body parser (see PostInviteResend)
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostUploadComplete
{
    export const URI : string = apiPath( "media", 1, "/uploads/:guid/complete" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostUploadComplete;
