//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";

//
// Disconnect a destination — revokes the marketplace installation, then removes the connection record.
// ACCOUNT-gated.
//
export class DeleteConnection extends RestfulEndpoint< DeleteConnection.Query, undefined, DeleteConnection.Response >
{
    public readonly uri      : string = DeleteConnection.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "deleteSocialConnection",
        summary:     "Disconnect a destination",
        description: "Revokes and removes a connected destination.",
        tags:        [ "Social" ],
        errors:      { 404: "No such connection in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteConnection
{
    export const URI : string = apiPath( "social", 1, "/connections/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; disconnected : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteConnection;
