//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// List the domains assigned to an account, + which is the default (links-6.1/6.2).
//
export class GetLinksAccountDomains extends RestfulEndpoint< GetLinksAccountDomains.Query, undefined, GetLinksAccountDomains.Response >
{
    public readonly uri      : string = GetLinksAccountDomains.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( accountId? : string ) { super( { accountId: accountId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "accountId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetLinksAccountDomains
{
    export const URI : string = apiPath( "links", 1, "/accounts/:accountId/domains" );
    export interface Query { accountId : string; }
    export interface Response { domains : Array<string>; default? : string; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetLinksAccountDomains;
// eof
