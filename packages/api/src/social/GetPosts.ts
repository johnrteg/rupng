//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialPost } from "./model/SocialPost";
import { Paging } from "../model/Paging";

//
// List the acting account's posts (paged, `{ data, page }` envelope). SENDER-gated.
//
export class GetPosts extends RestfulEndpoint< GetPosts.Query, undefined, GetPosts.Response >
{
    public readonly uri      : string = GetPosts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSocialPosts",
        summary:     "List posts",
        description: "Lists the acting account's posts (paged).",
        tags:        [ "Social" ],
    };

    constructor( query? : GetPosts.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "records", "page" ], properties: {
            records: { type: "array", description: "Posts on this page." },
            page:    { type: "object", description: "Paging envelope." },
        } };
    }
}

export namespace GetPosts
{
    export const URI : string = apiPath( "social", 1, "/posts" );

    export interface Query extends Paging.Request
    {
        status? : SocialPost.Status;
    }

    export interface Response extends Paging.Result<SocialPost.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetPosts;
