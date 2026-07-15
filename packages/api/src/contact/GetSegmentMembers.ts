//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Contact } from "./model/Contact";
import { Paging } from "../model/Paging";

//
// List the contacts in a segment (the segment_members join, hydrated to full contacts). USER-gated,
// first-party. For a dynamic (query) segment the live members come from search; this returns the
// MATERIALIZED join rows (manual membership + any snapshotted members).
//
export class GetSegmentMembers extends RestfulEndpoint< GetSegmentMembers.Query, undefined, GetSegmentMembers.Response >
{
    public readonly uri      : string = GetSegmentMembers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSegmentMembers",
        summary:     "List a segment's contacts",
        description: "Lists the contacts that belong to a segment (materialized membership).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string, paging? : Paging.Request ) { super( { id: id ?? "", ...paging } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSegmentMembers
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id/members" );

    export interface Query extends Paging.Request { id : Type.UUID; }
    export interface Response extends Paging.Result<Contact.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSegmentMembers;
