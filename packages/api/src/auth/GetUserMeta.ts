//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { UserMeta } from "./model/UserMeta";

//
// Read the calling user's metadata. Filter by `id` and/or `type` (both optional): by `id` → that one
// record; by `type` → all of that category; neither → all of the user's meta. Scoped to the caller.
//
//   client:
//   const endpt = new GetUserMeta( { type: "ui.layout" } );
//
export class GetUserMeta extends RestfulEndpoint<GetUserMeta.Query, undefined, GetUserMeta.Response>
{
    public readonly uri      : string = GetUserMeta.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // the caller's own meta
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetUserMeta.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "id",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
            { field: "type", location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
        ];
    }

    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetUserMeta
{
    export const URI : string = apiPath( "auth", 1, "/user/meta" );   // /api/auth/v1/user/meta

    export interface Query
    {
        id?   : Type.UUID;
        type? : string;
    }

    export interface Response
    {
        meta : Array<UserMeta.Entity>;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetUserMeta;
