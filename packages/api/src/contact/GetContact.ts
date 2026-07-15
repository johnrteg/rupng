//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Contact } from "./model/Contact";

//
// Fetch a single contact by id (tenant-scoped to the acting account). USER-gated, first-party.
//
export class GetContact extends RestfulEndpoint< GetContact.Query, undefined, GetContact.Response >
{
    public readonly uri      : string = GetContact.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getContact",
        summary:     "Get a contact",
        description: "Fetches a single contact by id.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such contact in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The contact.", properties: {
            id:        { type: "string", description: "Contact id." },
            firstName: { type: "string" }, lastName: { type: "string" },
            emails:    { type: "array", description: "Emails (value + context)." },
            phones:    { type: "array", description: "Phones (value + type)." },
            status:    { type: "string", description: "active | archived | forgotten." },
        } };
    }
}

export namespace GetContact
{
    export const URI : string = apiPath( "contact", 1, "/contacts/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Contact.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetContact;
