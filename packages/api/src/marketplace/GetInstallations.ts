//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Marketplace } from "./model/Marketplace";
import { Paging } from "../model/Paging";

//
// List the account's installations + status + health. USER-gated.
//
export class GetInstallations extends RestfulEndpoint< GetInstallations.Query, undefined, GetInstallations.Response >
{
    public readonly uri      : string = GetInstallations.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listMarketplaceInstallations",
        summary:     "List installations",
        description: "Lists the acting account's installations (paged).",
        tags:        [ "Marketplace" ],
    };

    constructor( query? : GetInstallations.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInstallations
{
    export const URI : string = apiPath( "marketplace", 1, "/installations" );

    export interface Query extends Paging.Request
    {
        status? : Marketplace.InstallStatus;
    }

    export interface Response extends Paging.Result<Marketplace.Installation> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInstallations;
