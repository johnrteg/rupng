//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Reset a segment's manual overrides — "unpin" — clearing the pinned-IN (MANUAL) rows and/or the pinned-OUT
// (EXCLUDED) tombstones, then re-materializing so membership reverts to pure query. USER-gated. At least one
// of `clearPins` / `clearExclusions` should be set (default: clear BOTH).
//
export class PostSegmentReset extends RestfulEndpoint< PostSegmentReset.Query, PostSegmentReset.Body, PostSegmentReset.Response >
{
    public readonly uri      : string = PostSegmentReset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resetSegmentOverrides",
        summary:     "Reset a segment's manual overrides",
        description: "Clears manual pin-in (MANUAL) and/or pin-out (EXCLUDED) rows, then re-materializes so membership reverts to the query.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string, body? : PostSegmentReset.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: { clearPins: { type: "boolean" }, clearExclusions: { type: "boolean" } },
        };
    }
}

export namespace PostSegmentReset
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/reset-overrides" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        clearPins?       : boolean;   // clear pinned-IN (MANUAL) rows — default true when neither is set
        clearExclusions? : boolean;   // clear pinned-OUT (EXCLUDED) tombstones — default true when neither is set
    }
    export interface Response { segmentId : Type.UUID; cleared : number; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSegmentReset;
