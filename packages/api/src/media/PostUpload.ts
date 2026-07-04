//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Request a pre-signed upload target (direct-to-S3). Creates the media index row (status UPLOADING) and
// returns it + the upload URL; the client PUTs the bytes straight to S3, then calls PostUploadComplete.
export class PostUpload extends RestfulEndpoint<{}, PostUpload.Body, PostUpload.Response>
{
    public readonly uri      : string = PostUpload.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostUpload.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "filename", "mime", "size", "scope" ],
            properties: {
                filename: { type: "string", minLength: 1, maxLength: 300 },
                mime:     { type: "string", minLength: 1 },
                size:     { type: "number", minimum: 1 },
                scope:    { type: "string", enum: Object.values( Media.Scope ) },
                scopeId:  { type: "string" },
                tier:     { type: "string", enum: Object.values( Media.Tier ) },
                kind:     { type: "string", enum: Object.values( Media.Kind ) },
            },
        };
    }
}

export namespace PostUpload
{
    export const URI : string = apiPath( "media", 1, "/uploads" );
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        filename : string;
        mime     : string;
        size     : number;
        scope    : Media.Scope;
        scopeId? : string;         // campaignId (CAMPAIGN) or userId (USER avatar)
        tier?    : Media.Tier;
        kind?    : Media.Kind;
    }
    export interface Response { asset : Media.Asset; upload : { url : string; method : string; expiresAt : string }; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostUpload;
