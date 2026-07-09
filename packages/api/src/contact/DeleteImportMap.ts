//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Delete an account import map — SOFT delete (status → deleted; recoverable by an app admin, purged by a cron
// after a TTL) so past import jobs / audit that reference the map keep resolving. ACCOUNT-gated. A SYSTEM map
// cannot be deleted (403).
//
export class DeleteImportMap extends RestfulEndpoint< DeleteImportMap.Query, undefined, DeleteImportMap.Response >
{
    public readonly uri      : string = DeleteImportMap.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "deleteImportMap",
        summary:     "Delete an import map",
        description: "Soft-deletes an account import map (status → deleted; recoverable by an admin, purged by a cron after a TTL). System maps cannot be deleted (403).",
        tags:        [ "Contact" ],
        errors:      { 403: "System maps cannot be deleted", 404: "No such import map in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteImportMap
{
    export const URI : string = apiPath( "contact", 1, "/importmaps/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; deleted : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,   // system map — not deletable
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteImportMap;
