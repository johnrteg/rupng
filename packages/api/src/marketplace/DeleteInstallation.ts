//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";

//
// S2S: uninstall — revoke upstream where supported, purge the stored connection, mark the Installation
// REMOVED (never hard-deleted; consistent with the platform's archive-vs-GDPR rules).
//
export class DeleteInstallation extends RestfulEndpoint< DeleteInstallation.Query, undefined, DeleteInstallation.Response >
{
    public readonly uri      : string = DeleteInstallation.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteInstallation
{
    export const URI : string = apiPath( "marketplace", 1, "/internal/installations/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { installationId : Type.UUID; removed : boolean; }

    export enum Error
    {
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteInstallation;
