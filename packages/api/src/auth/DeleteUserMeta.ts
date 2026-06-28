//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Delete one of the calling user's metadata records by `id` (path param). Scoped to the caller.
//
//   client:
//   const endpt = new DeleteUserMeta( { id } );
//
export class DeleteUserMeta extends RestfulEndpoint<DeleteUserMeta.Query, undefined, DeleteUserMeta.Response>
{
    public readonly uri      : string = DeleteUserMeta.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // the caller's own meta
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : DeleteUserMeta.Query )
    {
        super( query ?? { id: "" }, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true },
        ];
    }

    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteUserMeta
{
    export const URI : string = apiPath( "auth", 1, "/user/meta/:id" );   // /api/auth/v1/user/meta/:id

    export interface Query
    {
        id : string;    // path param — the meta record id
    }

    export interface Response
    {
        deleted : boolean;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteUserMeta;
