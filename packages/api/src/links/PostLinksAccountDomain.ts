//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Assign a registry domain to an account (links-6.3) — platform admin action.
//
export class PostLinksAccountDomain extends RestfulEndpoint< PostLinksAccountDomain.Query, PostLinksAccountDomain.Body, PostLinksAccountDomain.Response >
{
    public readonly uri      : string = PostLinksAccountDomain.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( accountId? : string, body? : PostLinksAccountDomain.Body ) { super( { accountId: accountId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "accountId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "domain" ], properties: { domain: { type: "string" } } }; }
}

export namespace PostLinksAccountDomain
{
    export const URI : string = apiPath( "links", 1, "/accounts/:accountId/domains" );
    export interface Query { accountId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { domain : string; }
    export interface Response { assigned : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostLinksAccountDomain;
// eof
