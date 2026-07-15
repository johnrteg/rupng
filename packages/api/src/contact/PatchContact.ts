//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Contact } from "./model/Contact";

//
// Update a contact (any subset of the editable fields). USER-gated, first-party. Server bumps the audit
// modifiedAt/By. Body is validated loosely; the impl merges + re-validates the record.
//
export class PatchContact extends RestfulEndpoint< PatchContact.Query, PatchContact.Body, PatchContact.Response >
{
    public readonly uri      : string = PatchContact.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateContact",
        summary:     "Update a contact",
        description: "Updates a contact (any subset of editable fields).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such contact in this account" },
    };

    constructor( id? : string, body? : PatchContact.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, properties: {} };
    }
}

export namespace PatchContact
{
    export const URI : string = apiPath( "contact", 1, "/contacts/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest, Contact.UpdateContact {}
    export interface Response extends Contact.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchContact;
