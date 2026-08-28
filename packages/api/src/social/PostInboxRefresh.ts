//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";

//
// On-demand pull for a pull-only connection (X / TikTok / LinkedIn). 409 (with `cooldownUntil`) if
// already in flight or still cooling down — the abuse guard on the manual Refresh button. USER-gated.
//
export class PostInboxRefresh extends RestfulEndpoint< {}, PostInboxRefresh.Body, PostInboxRefresh.Response >
{
    public readonly uri      : string = PostInboxRefresh.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "refreshSocialInbox",
        summary:     "Refresh a pull-only connection now",
        description: "Triggers an on-demand poll for a pull-only connection (X/TikTok/LinkedIn).",
        tags:        [ "Social" ],
        errors:      { 409: "Already in flight or still cooling down" },
    };

    constructor( body? : PostInboxRefresh.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "connectionId" ], properties: { connectionId: { type: "string" } } }; }
}

export namespace PostInboxRefresh
{
    export const URI : string = apiPath( "social", 1, "/inbox/refresh" );

    export interface Body extends RestfulEndpoint.AuthRequest { connectionId : Type.UUID; }
    export interface Response { accepted : boolean; cooldownUntil? : Type.ISODateTime; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInboxRefresh;
