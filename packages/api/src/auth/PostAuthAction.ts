//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AuthAction } from "./model/AuthAction";

//
// Create a pending action (INTERNAL / S2S) — a producer (auth flows, other services) mints a TTL landing token
// for verify / reset / mfa / invite / unsubscribe. Returns the opaque `actionId` (the URL token) + its landing
// PATH + the epoch-seconds expiry. The caller assembles the full URL (base resolved at send) and emails it.
//
export class PostAuthAction extends RestfulEndpoint< {}, PostAuthAction.Body, PostAuthAction.Response >
{
    public readonly uri      : string = PostAuthAction.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // S2S (INTERNAL audience)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    constructor( body? : PostAuthAction.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, required: [ "type", "target" ], properties: {
            type: { type: "string", enum: Object.values( AuthAction.Type ) }, target: { type: "string" },
            accountId: { type: "string" }, userId: { type: "string" }, ttlMinutes: { type: "number" } } };
    }
}

export namespace PostAuthAction
{
    export const URI : string = apiPath( "auth", 1, "/actions" );
    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        type        : AuthAction.Type;
        target      : string;
        accountId?  : string;
        userId?     : string;
        ttlMinutes? : number;                    // override the type's default window
        requestedBy? : string;
        params?     : Record<string, string>;
    }
    export interface Response { actionId : string; path : string; expiresAt : number; }
}

export default PostAuthAction;
// eof
