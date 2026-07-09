//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Segment } from "./model/Segment";

//
// Refresh a segment — re-run the materialize job from its saved filter (reconcile QUERY membership, honoring
// the user's pins). Returns immediately (202-style): status goes PENDING and the job fills membership + logs a
// run. USER-gated. A segment without a filter just gets a count refresh.
//
export class PostSegmentRefresh extends RestfulEndpoint< PostSegmentRefresh.Query, PostSegmentRefresh.Body, PostSegmentRefresh.Response >
{
    public readonly uri      : string = PostSegmentRefresh.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "refreshSegment",
        summary:     "Refresh a segment",
        description: "Re-runs the segment's membership materialization from its filter (honoring pins). Async — status → pending.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" }, {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostSegmentRefresh
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/refresh" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { segmentId : Type.UUID; status : Segment.Status; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSegmentRefresh;
