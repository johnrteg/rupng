//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import type { Type } from "@repo/common";

//
// S2S: enqueue an outbound action against a provider's API, routed through the OAuth broker's proxy
// (auth injected — no token handling at the call site). Provider-agnostic: no per-connector logic is
// required for a plain REST call, which is what most workflow "action" nodes are. Enqueued, never
// proxied inline (an outbound 3rd-party call can take longer than 500ms) — `MarketplaceActionJob`
// does the actual call.
//
export class PostInternalAction extends RestfulEndpoint< {}, PostInternalAction.Body, PostInternalAction.Response >
{
    public readonly uri      : string = PostInternalAction.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    constructor( body? : PostInternalAction.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "installationId", "method", "endpoint" ],
            properties: {
                accountId:     { type: "string" },
                installationId: { type: "string" },
                method:        { type: "string", enum: [ "GET", "POST", "PUT", "PATCH", "DELETE" ] },
                endpoint:      { type: "string" },
                params:        { type: "object" },
                data:          {},
            },
        };
    }
}

export namespace PostInternalAction
{
    export const URI : string = apiPath( "marketplace", 1, "/internal/actions" );

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId:      Type.UUID;
        installationId: Type.UUID;
        method:         "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        endpoint:       string;
        params?:        Type.JsonObject;
        data?:          Type.Json;
    }

    export interface Response { accepted : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInternalAction;
