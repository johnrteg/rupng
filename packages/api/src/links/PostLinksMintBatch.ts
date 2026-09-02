//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Links } from "./model/Links";

//
// Bulk-mint tracked links for a campaign send (links-1.1) — one request per recipient, same shape
// as PostLinksMint's body.
//
export class PostLinksMintBatch extends RestfulEndpoint< {}, PostLinksMintBatch.Body, PostLinksMintBatch.Response >
{
    public readonly uri      : string = PostLinksMintBatch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "mintLinkBatch",
        summary:     "Bulk-mint tracked links",
        description: "Mints one link per recipient for a campaign send.",
        tags:        [ "Links" ],
    };

    constructor( body? : PostLinksMintBatch.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "requests" ],
            properties: { requests: { type: "array", minItems: 1, maxItems: 1000, items: { type: "object" } } },
        };
    }
}

export namespace PostLinksMintBatch
{
    export const URI : string = apiPath( "links", 1, "/mint/batch" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { requests : Array<Links.MintRequest>; }
    export interface Response { results : Array<Links.MintResult>; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostLinksMintBatch;
// eof
