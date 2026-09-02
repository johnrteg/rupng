//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Links } from "./model/Links";

//
// Trigger / poll DNS verification + cert provisioning for a registry domain (links-5.3). MVP: no
// real DNS/ACM automation (links-5.6 is deferred) — this immediately flips a `pending` domain to
// `active`, same "fake automation" posture as the other services' fake providers.
//
export class PostLinksDomainVerify extends RestfulEndpoint< PostLinksDomainVerify.Query, undefined, PostLinksDomainVerify.Response >
{
    public readonly uri      : string = PostLinksDomainVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "verifyLinkDomain",
        summary:     "Verify a registry domain",
        description: "Triggers/polls DNS verification + cert provisioning. MVP: immediately marks the domain active.",
        tags:        [ "Links" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostLinksDomainVerify
{
    export const URI : string = apiPath( "links", 1, "/domains/:id/verify" );
    export interface Query { id : string; }   // the domain host, used as its own id
    export interface Response extends Links.ShortDomain {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default PostLinksDomainVerify;
// eof
