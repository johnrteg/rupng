//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Set the account's default short domain (links-6.2) — used when a mint call doesn't name one.
// Account-admin self-serve, among its assigned domains.
//
export class PutLinksAccountDomainDefault extends RestfulEndpoint< PutLinksAccountDomainDefault.Query, PutLinksAccountDomainDefault.Body, PutLinksAccountDomainDefault.Response >
{
    public readonly uri      : string = PutLinksAccountDomainDefault.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( accountId? : string, body? : PutLinksAccountDomainDefault.Body ) { super( { accountId: accountId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "accountId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "domain" ], properties: { domain: { type: "string" } } }; }
}

export namespace PutLinksAccountDomainDefault
{
    export const URI : string = apiPath( "links", 1, "/accounts/:accountId/domains/default" );
    export interface Query { accountId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { domain : string; }
    export interface Response { default : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PutLinksAccountDomainDefault;
// eof
