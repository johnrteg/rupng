//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Links } from "./model/Links";

//
// Add a domain to the registry (links-5.2) — platform staff (step-up: ROOT). Starts `pending`;
// DNS-verify + cert automation is the deferred links-5.3/5.6 — MVP marks it `active` immediately
// (see PostLinksDomainVerifyImpl's "fake automation" comment).
//
export class PostLinksDomain extends RestfulEndpoint< {}, PostLinksDomain.Body, PostLinksDomain.Response >
{
    public readonly uri      : string = PostLinksDomain.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "addLinkDomain",
        summary:     "Add a short domain to the registry",
        description: "Registers a new shared or whitelabel short domain (starts pending until DNS/cert verified).",
        tags:        [ "Links" ],
    };

    constructor( body? : PostLinksDomain.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "domain", "kind" ],
            properties: {
                domain:         { type: "string" },
                kind:           { type: "string", enum: Object.values( Links.DomainKind ) },
                ownerAccountId: { type: "string" },
            },
        };
    }
}

export namespace PostLinksDomain
{
    export const URI : string = apiPath( "links", 1, "/domains" );
    export interface Body extends RestfulEndpoint.AuthRequest { domain : string; kind : Links.DomainKind; ownerAccountId? : string; }
    export interface Response extends Links.ShortDomain {}
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostLinksDomain;
// eof
