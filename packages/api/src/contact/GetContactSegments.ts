//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Segment } from "./model/Segment";
import { Paging } from "../model/Paging";

//
// List the segments a contact belongs to (the segment_members join, inverted GSI → hydrated to segments).
// USER-gated, first-party. Powers the contact detail's "segments this contact is in" view.
//
export class GetContactSegments extends RestfulEndpoint< GetContactSegments.Query, undefined, GetContactSegments.Response >
{
    public readonly uri      : string = GetContactSegments.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listContactSegments",
        summary:     "List a contact's segments",
        description: "Lists the segments a contact belongs to.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such contact in this account" },
    };

    constructor( id? : string, paging? : Paging.Request ) { super( { id: id ?? "", ...paging } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetContactSegments
{
    export const URI : string = apiPath( "contact", 1, "/contacts/:id/segments" );

    export interface Query extends Paging.Request { id : Type.UUID; }
    export interface Response extends Paging.Result<Segment.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetContactSegments;
