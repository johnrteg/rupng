//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Segment } from "./model/Segment";

//
// Create a segment (a saved boolean query over contacts). Server assigns id / accountId / status / audit.
// USER-gated, first-party.
//
export class PostSegment extends RestfulEndpoint< {}, PostSegment.Body, PostSegment.Response >
{
    public readonly uri      : string = PostSegment.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createSegment",
        summary:     "Create a segment",
        description: "Creates a saved segment (a boolean query over the account's contacts).",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostSegment.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "name", "query" ],
            properties: {
                name:        { type: "string", minLength: 1 },
                query:       { type: "object" },
                isExclusion: { type: "boolean" },
                tags:        { type: "array", items: { type: "string" } },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The created segment.", properties: {
            id:     { type: "string", description: "New segment id." },
            name:   { type: "string", description: "Display name." },
            status: { type: "string", description: "active." },
        } };
    }
}

export namespace PostSegment
{
    export const URI : string = apiPath( "contact", 1, "/segments" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name         : string;
        query        : Segment.Query;
        isExclusion? : boolean;
        tags?        : Array<string>;
        sort?        : Segment.Sort;
        limit?       : number;
    }
    export interface Response extends Segment.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSegment;
