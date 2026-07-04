//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Duplicate a media envelope — a fresh copy with a NEW guid: its item bytes are copied in S3, its name becomes
// "Copy of <original>", createdAt is the copy time, and createdBy is the copier. The copy starts fresh
// (no campaign associations, derived items re-derived by the pipeline unless asked). Returns the new asset.
export class PostAssetDuplicate extends RestfulEndpoint<PostAssetDuplicate.Query, PostAssetDuplicate.Body, PostAssetDuplicate.Response>
{
    public readonly uri      : string = PostAssetDuplicate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PostAssetDuplicate.Body ) { super( { guid: guid ?? "" }, body ?? {} ); }   // empty body ({}) — a null-body POST trips the server body parser
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // `name`: rename the copy (else "Copy of <original>"). `includeDerived`: copy the derived items too
        // (else just the original file is copied and the copy re-derives them via the pipeline).
        return { type: "object", additionalProperties: false, properties: {
            name:           { type: "string", minLength: 1, maxLength: 300 },
            includeDerived: { type: "boolean" },
        } };
    }
}

export namespace PostAssetDuplicate
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/duplicate" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { name? : string; includeDerived? : boolean; }
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostAssetDuplicate;
