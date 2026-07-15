//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";

//
// Create a custom-field definition. Server assigns uid / accountId / status / audit. ACCOUNT-gated (managing
// the account's field schema). `type` is set here and is immutable thereafter.
//
export class PostContactField extends RestfulEndpoint< {}, PostContactField.Body, PostContactField.Response >
{
    public readonly uri      : string = PostContactField.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createContactField",
        summary:     "Create a custom field",
        description: "Defines a new custom contact field (type is immutable once created).",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostContactField.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "label", "type" ],
            properties: {
                label:    { type: "string", minLength: 1 },
                type:     { type: "string", enum: Object.values( Contact.CustomFieldType ) },
                choices:  { type: "array", items: { type: "object", additionalProperties: false, required: [ "key", "label" ], properties: { key: { type: "string" }, label: { type: "string" } } } },
                currency: { type: "string" },
                required: { type: "boolean" },
                indexed:  { type: "boolean" },
                group:    { type: "string" },
                order:    { type: "number" },
            },
        };
    }
}

export namespace PostContactField
{
    export const URI : string = apiPath( "contact", 1, "/fields" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        label:     string;
        type:      Contact.CustomFieldType;
        choices?:  Array<Contact.ChoiceOption>;
        currency?: string;
        required?: boolean;
        indexed?:  boolean;
        group?:    string;
        order?:    number;
    }
    export interface Response extends Contact.CustomFieldDef {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostContactField;
