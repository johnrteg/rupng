//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Links } from "./model/Links";

//
// List the short-domain registry — shared + whitelabel (links-5.1). Platform-staff only.
//
export class GetLinksDomains extends RestfulEndpoint< {}, undefined, GetLinksDomains.Response >
{
    public readonly uri      : string = GetLinksDomains.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listLinkDomains",
        summary:     "List the short-domain registry",
        description: "Lists every registered short domain (shared + whitelabel) and its status.",
        tags:        [ "Links" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetLinksDomains
{
    export const URI : string = apiPath( "links", 1, "/domains" );
    export interface Response { records : Array<Links.ShortDomain>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetLinksDomains;
// eof
