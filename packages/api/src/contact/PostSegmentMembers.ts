//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Add contacts to a segment (manual membership). Idempotent: the join key is (segment, contact), so adding a
// contact already in the segment is a no-op — no duplicates. USER-gated, first-party. Bulk (contactIds[]).
//
export class PostSegmentMembers extends RestfulEndpoint< PostSegmentMembers.Query, PostSegmentMembers.Body, PostSegmentMembers.Response >
{
    public readonly uri      : string = PostSegmentMembers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "addSegmentMembers",
        summary:     "Add contacts to a segment",
        description: "Adds one or more contacts to a segment's manual membership (idempotent — no duplicates).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string, body? : PostSegmentMembers.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "contactIds" ],
            properties: { contactIds: { type: "array", items: { type: "string" } } },
        };
    }
}

export namespace PostSegmentMembers
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/members" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest { contactIds : Array<Type.UUID>; }
    /** `added` = newly-inserted; `skipped` = already present (deduped). */
    export interface Response { added : number; skipped : number; size : number; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSegmentMembers;
