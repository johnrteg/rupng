//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";
import { Paging } from "../model/Paging";

//
// List the acting account's contacts (paged, `{ data, page }` envelope). USER-gated, first-party (APP).
//
export class GetContacts extends RestfulEndpoint< GetContacts.Query, undefined, GetContacts.Response >
{
    public readonly uri      : string = GetContacts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listContacts",
        summary:     "List contacts",
        description: "Lists the acting account's contacts (paged — ?count / ?start; returns { data, page }).",
        tags:        [ "Contact" ],
    };

    constructor( query? : GetContacts.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "records", "page" ], properties: {
            records: { type: "array", description: "Contacts on this page.", items: { type: "object", properties: {
                id: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, status: { type: "string" } } } },
            page: { type: "object", description: "Paging envelope.", properties: {
                count: { type: "number" }, total: { type: "number" }, next: { type: "string" } } },
        } };
    }
}

export namespace GetContacts
{
    export const URI : string = apiPath( "contact", 1, "/contacts" );

    export interface Query extends Paging.Request
    {
        status? : Contact.ContactStatus;
    }

    export interface Response extends Paging.Result<Contact.Entity> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetContacts;
