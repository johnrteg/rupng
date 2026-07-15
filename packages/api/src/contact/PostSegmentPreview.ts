//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Segment } from "./model/Segment";
import { Contact } from "./model/Contact";

//
// Preview an (unsaved) segment query: evaluate the filter against the account's contacts and return the match
// COUNT plus a small sample, honoring the optional `sort` + `limit` (top-N by sort). USER-gated. This is the
// bounded, in-service preview used by the builder; production-scale evaluation runs against search (see SPECS).
//
export class PostSegmentPreview extends RestfulEndpoint< {}, PostSegmentPreview.Body, PostSegmentPreview.Response >
{
    public readonly uri      : string = PostSegmentPreview.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "previewSegment",
        summary:     "Preview a segment query",
        description: "Evaluates a segment filter against the account's contacts; returns the match count + a sample, honoring optional sort + limit.",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostSegmentPreview.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "query" ],
            properties: {
                query:  { type: "object" },
                sort:   { type: "object" },
                limit:  { type: "number" },
                sample: { type: "number" },
            },
        };
    }
}

export namespace PostSegmentPreview
{
    export const URI : string = apiPath( "contact", 1, "/segments/preview" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        query   : Segment.Query;
        sort?   : Segment.Sort;
        limit?  : number;         // cap to top-N by sort (ignored without a sort)
        sample? : number;         // max rows to return for display (default 100)
    }
    export interface Response
    {
        total    : number;               // contacts matching the filter (before any limit)
        count    : number;               // effective count after applying `limit`
        records  : Array<Contact.Entity>; // a display sample (sorted + limited), capped to `sample`
        unsupportedFields? : Array<string>; // fields the preview couldn't fully evaluate (non-constraining)
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSegmentPreview;
