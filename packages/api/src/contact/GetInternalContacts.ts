//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";
import { Paging } from "../model/Paging";

//
// S2S: list an EXPLICIT account's contacts (paged, `{ records, page }` envelope). INTERNAL audience — no
// user session/X-Account on an S2S call, so the caller passes `accountId` explicitly instead of relying on
// ambient account-context. First consumer: the `report` service, which never reads contact's own DB directly.
//
export class GetInternalContacts extends RestfulEndpoint< GetInternalContacts.Query, undefined, GetInternalContacts.Response >
{
    public readonly uri      : string = GetInternalContacts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listInternalContacts",
        summary:     "List an account's contacts (S2S)",
        description: "Lists the given account's contacts (paged — ?count / ?start; returns { records, page }).",
        tags:        [ "Contact" ],
    };

    constructor( query? : GetInternalContacts.Query ) { super( query ?? { accountId: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId" ],
            properties: {
                accountId: { type: "string" },
                status:    { type: "string", enum: Object.values( Contact.ContactStatus ) },
                count:     { type: "number" },
                start:     { type: "string" },
            },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInternalContacts
{
    export const URI : string = apiPath( "contact", 1, "/internal/contacts" );

    export interface Query extends Paging.Request
    {
        accountId : string;
        status?   : Contact.ContactStatus;
    }

    export interface Response extends Paging.Result<Contact.Entity> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalContacts;
// eof
