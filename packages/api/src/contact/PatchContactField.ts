//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Contact } from "./model/Contact";

//
// Edit a custom-field definition — label / choices (add-only) / currency / required / indexed / group / order
// / status. TYPE and uid are immutable and cannot be changed here. ACCOUNT-gated.
//
export class PatchContactField extends RestfulEndpoint< PatchContactField.Query, PatchContactField.Body, PatchContactField.Response >
{
    public readonly uri      : string = PatchContactField.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateContactField",
        summary:     "Update a custom field",
        description: "Edits a custom field's label/choices/group/order/etc. Type is immutable.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such field in this account" },
    };

    constructor( uid? : string, body? : PatchContactField.Body ) { super( { uid: uid ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "uid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, properties: {} };
    }
}

export namespace PatchContactField
{
    export const URI : string = apiPath( "contact", 1, "/fields/:uid" );

    export interface Query { uid : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        label?:    string;
        choices?:  Array<Contact.ChoiceOption>;
        currency?: string;
        required?: boolean;
        indexed?:  boolean;
        group?:    string;
        order?:    number;
        status?:   Contact.CustomFieldStatus;
    }
    export interface Response extends Contact.CustomFieldDef {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchContactField;
