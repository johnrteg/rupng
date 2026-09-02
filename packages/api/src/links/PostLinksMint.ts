//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Links } from "./model/Links";

//
// Mint a single tracked (or untracked) link (links-1.1/1.4/1.6). S2S ONLY — campaign / workflow /
// channel call this at send/render time; there is no user-facing "shorten a URL" route.
//
export class PostLinksMint extends RestfulEndpoint< {}, PostLinksMint.Body, PostLinksMint.Response >
{
    public readonly uri      : string = PostLinksMint.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "mintLink",
        summary:     "Mint a tracked or untracked link",
        description: "Issues an opaque code -> target mapping stamped with the attribution tuple. Omit contactId for an untracked (shared CTA) link.",
        tags:        [ "Links" ],
    };

    constructor( body? : PostLinksMint.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "target", "targetType", "channel" ],
            properties: {
                accountId:  { type: "string" },
                target:     { type: "string" },
                targetType: { type: "string", enum: Object.values( Links.TargetType ) },
                campaignId: { type: "string" },
                contactId:  { type: "string" },
                channel:    { type: "string" },
                messageId:  { type: "string" },
                domain:     { type: "string" },
            },
        };
    }
}

export namespace PostLinksMint
{
    export const URI : string = apiPath( "links", 1, "/mint" );
    export interface Body extends RestfulEndpoint.NonAuthRequest, Links.MintRequest {}
    export interface Response extends Links.MintResult {}
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostLinksMint;
// eof
