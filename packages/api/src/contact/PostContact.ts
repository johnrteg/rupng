//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";

//
// Create a contact under the acting account. Server assigns id / accountId / status / audit. USER-gated.
// Body is validated loosely (formatless) — the impl normalizes emails/phones.
//
export class PostContact extends RestfulEndpoint< {}, PostContact.Body, PostContact.Response >
{
    public readonly uri      : string = PostContact.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createContact",
        summary:     "Create a contact",
        description: "Creates a contact under the acting account.",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostContact.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // loose (formatless) schema — at least one email or phone is enforced in the impl
        return {
            type: "object", additionalProperties: true,
            properties: {
                firstName: { type: "string" },
                lastName:  { type: "string" },
                emails:    { type: "array" },
                phones:    { type: "array" },
                addresses: { type: "array" },
                tags:      { type: "array" },
                notes:     { type: "string" },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The created contact.", properties: {
            id:        { type: "string", description: "New contact id." },
            firstName: { type: "string" }, lastName: { type: "string" },
            status:    { type: "string", description: "active." },
        } };
    }
}

export namespace PostContact
{
    export const URI : string = apiPath( "contact", 1, "/contacts" );

    export interface Body extends RestfulEndpoint.AuthRequest, Contact.CreateContact {}
    export interface Response extends Contact.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostContact;
