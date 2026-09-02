//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Unassign a domain from an account (links-6.3) — platform admin action.
//
export class DeleteLinksAccountDomain extends RestfulEndpoint< DeleteLinksAccountDomain.Query, undefined, DeleteLinksAccountDomain.Response >
{
    public readonly uri      : string = DeleteLinksAccountDomain.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( accountId? : string, domain? : string ) { super( { accountId: accountId ?? "", domain: domain ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "accountId", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "domain",    location: RestfulEndpoint.AttrLocation.URI, required: true },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteLinksAccountDomain
{
    export const URI : string = apiPath( "links", 1, "/accounts/:accountId/domains/:domain" );
    export interface Query { accountId : string; domain : string; }
    export interface Response { unassigned : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default DeleteLinksAccountDomain;
// eof
