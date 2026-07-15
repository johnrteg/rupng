//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Archive a custom-field definition (soft — status → ARCHIVED; fields are never removed, so existing values /
// segments / history keep referencing it). ACCOUNT-gated.
//
export class DeleteContactField extends RestfulEndpoint< DeleteContactField.Query, undefined, DeleteContactField.Response >
{
    public readonly uri      : string = DeleteContactField.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "deleteContactField",
        summary:     "Delete a custom field",
        description: "Soft-deletes a custom field (status → deleted; recoverable by an admin, purged by a cron after a TTL) ONLY if no contact uses it; returns 409 when it's in use (archive it instead).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such field in this account", 409: "Field is in use by one or more contacts — archive it instead" },
    };

    constructor( uid? : string ) { super( { uid: uid ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "uid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteContactField
{
    export const URI : string = apiPath( "contact", 1, "/fields/:uid" );

    export interface Query { uid : Type.UUID; }
    export interface Response { uid : Type.UUID; deleted : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,   // field is in use — archive instead
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteContactField;
