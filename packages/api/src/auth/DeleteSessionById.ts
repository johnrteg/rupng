//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Revoke a specific session (by id).
//
export class DeleteSessionById extends RestfulEndpoint<DeleteSessionById.Query, undefined, DeleteSessionById.Response>
{
    public readonly uri      : string = DeleteSessionById.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : DeleteSessionById.Query ) { super( query ?? { sessionId: "" }, undefined ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "sessionId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteSessionById
{
    export const URI : string = apiPath( "auth", 1, "/sessions/:sessionId" );   // /api/auth/v1/sessions/:sessionId

    export interface Query { sessionId : string; }
    export interface Response { ok : boolean; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteSessionById;
