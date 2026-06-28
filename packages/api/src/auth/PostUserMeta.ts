//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { UserMeta } from "./model/UserMeta";

//
// Create or update one of the calling user's metadata records. Omit `id` to create (server mints one);
// include it to upsert that record. Scoped to the caller. Returns the saved record.
//
//   client:
//   const endpt = new PostUserMeta( { type: "ui.layout", object: { sidebar: "collapsed" } } );
//
export class PostUserMeta extends RestfulEndpoint<{}, PostUserMeta.Body, PostUserMeta.Response>
{
    public readonly uri      : string = PostUserMeta.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // the caller's own meta
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostUserMeta.Body )
    {
        super( {}, body );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }

    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: 'object',
            properties: {
                id:     { type: 'string' },     // omit to create
                type:   { type: 'string' },
                object: {}                      // any JSON payload
            },
            required: ['type', 'object'],
            additionalProperties: false
        };
    }
}

export namespace PostUserMeta
{
    export const URI : string = apiPath( "auth", 1, "/user/meta" );   // /api/auth/v1/user/meta

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        id?    : Type.UUID;            // omit → create; present → upsert
        type   : string;
        object : Type.Json;
    }

    export interface Response extends UserMeta.Entity
    {
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostUserMeta;
