//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Promote selected staged candidates (media-18) into the account library — copies each chosen candidate's
// bytes from the staging bucket into the media bucket, creates a `Media.Asset` (source.origin = generated),
// and discards the rest of the batch. The generated assets then run the normal pipeline / appear in the
// library. Returns the created assets' guids + names.
export class PostGeneratePromote extends RestfulEndpoint<PostGeneratePromote.Query, PostGeneratePromote.Body, PostGeneratePromote.Response>
{
    public readonly uri      : string = PostGeneratePromote.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( batchId? : string, body? : PostGeneratePromote.Body ) { super( { batchId: batchId ?? "" }, body ?? { candidateIds: [] } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "batchId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "candidateIds" ], properties: {
            candidateIds: { type: "array", items: { type: "string" }, minItems: 1 },
            name:         { type: "string", maxLength: 100 },   // base name; each asset gets "name" / "name (2)" …
            tags:         { type: "array", items: { type: "string" } },
            campaignIds:  { type: "array", items: { type: "string" } },   // 0..N campaigns to tag the promoted assets with
        } };
    }
}

export namespace PostGeneratePromote
{
    export const URI : string = apiPath( "media", 1, "/generate/:batchId/promote" );
    export interface Query { batchId : string; }
    // `campaignIds` — optionally file the promoted assets into 0..N campaigns on acceptance.
    export interface Body extends RestfulEndpoint.AuthRequest { candidateIds : Array<string>; name? : string; tags? : Array<string>; campaignIds? : Array<string>; }
    export interface Response { assets : Array<{ guid : string; name : string }>; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostGeneratePromote;
