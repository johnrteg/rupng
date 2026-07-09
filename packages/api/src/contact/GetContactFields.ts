//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";
import { Paging } from "../model/Paging";

//
// List the account's custom-field definitions (for the Settings manager + to render the contact profile
// editor). USER-gated (rendering the profile needs it); managing them is ACCOUNT-gated (see Post/Patch/Delete).
//
export class GetContactFields extends RestfulEndpoint< GetContactFields.Query, undefined, GetContactFields.Response >
{
    public readonly uri      : string = GetContactFields.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listContactFields",
        summary:     "List custom field definitions",
        description: "Lists the account's custom contact-field definitions (grouped/ordered for the profile).",
        tags:        [ "Contact" ],
    };

    constructor( query? : GetContactFields.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetContactFields
{
    export const URI : string = apiPath( "contact", 1, "/fields" );

    export interface Query extends Paging.Request
    {
        status? : Contact.CustomFieldStatus;   // default: active only
    }
    export interface Response extends Paging.Result<Contact.CustomFieldDef> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetContactFields;
