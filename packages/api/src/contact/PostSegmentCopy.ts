//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Segment } from "./model/Segment";

//
// Copy a segment — clone its filter / sort / limit into a NEW segment, choosing which manual overrides to
// carry over: `copyPins` (pinned-IN MANUAL rows) and `copyExclusions` (pinned-OUT EXCLUDED tombstones). This
// is the clean way to "unpin" — copy WITHOUT the pins to get a pure query segment. The new segment
// re-materializes from its filter. USER-gated.
//
export class PostSegmentCopy extends RestfulEndpoint< PostSegmentCopy.Query, PostSegmentCopy.Body, PostSegmentCopy.Response >
{
    public readonly uri      : string = PostSegmentCopy.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "copySegment",
        summary:     "Copy a segment",
        description: "Clones a segment's filter/sort/limit into a new segment; optionally carries the pinned-in and/or pinned-out overrides.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string, body? : PostSegmentCopy.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: { name: { type: "string" }, copyPins: { type: "boolean" }, copyExclusions: { type: "boolean" } },
        };
    }
}

export namespace PostSegmentCopy
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/copy" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name?           : string;    // new name (defaults to "<original> (copy)")
        copyPins?       : boolean;   // carry the pinned-IN (MANUAL) rows into the copy
        copyExclusions? : boolean;   // carry the pinned-OUT (EXCLUDED) tombstones into the copy
    }
    export interface Response extends Segment.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSegmentCopy;
