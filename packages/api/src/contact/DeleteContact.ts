//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Archive a contact (soft — never hard-deleted; status → ARCHIVED, restorable). GDPR forget is a separate,
// heavier flow. USER-gated, first-party.
//
export class DeleteContact extends RestfulEndpoint< DeleteContact.Query, undefined, DeleteContact.Response >
{
    public readonly uri      : string = DeleteContact.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archiveContact",
        summary:     "Archive a contact",
        description: "Archives a contact (soft — status becomes archived, restorable; never hard-deleted).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such contact in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteContact
{
    export const URI : string = apiPath( "contact", 1, "/contacts/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; archived : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteContact;
