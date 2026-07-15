//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Archive a segment (soft — status → ARCHIVED; segments are never hard-deleted so past runs / audit keep
// referencing them). USER-gated, first-party.
//
export class DeleteSegment extends RestfulEndpoint< DeleteSegment.Query, undefined, DeleteSegment.Response >
{
    public readonly uri      : string = DeleteSegment.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archiveSegment",
        summary:     "Archive a segment",
        description: "Archives a segment (soft — never hard-deleted).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteSegment
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; archived : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteSegment;
