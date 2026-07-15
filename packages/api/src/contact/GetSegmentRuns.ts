//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Segment } from "./model/Segment";
import { Paging } from "../model/Paging";

//
// List a segment's materialization run history — newest first — for the "when / who / how many changed" audit.
// USER-gated, first-party.
//
export class GetSegmentRuns extends RestfulEndpoint< GetSegmentRuns.Query, undefined, GetSegmentRuns.Response >
{
    public readonly uri      : string = GetSegmentRuns.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSegmentRuns",
        summary:     "List a segment's run history",
        description: "Lists the segment's materialization runs (newest first): when, who, and how many were added/removed.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string, paging? : Paging.Request ) { super( { id: id ?? "", ...paging } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSegmentRuns
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/runs" );

    export interface Query extends Paging.Request { id : Type.UUID; }
    export interface Response extends Paging.Result<Segment.Run> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSegmentRuns;
