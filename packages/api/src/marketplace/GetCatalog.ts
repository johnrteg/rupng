//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Marketplace } from "./model/Marketplace";
import { Paging } from "../model/Paging";

//
// Browse / search the integration catalog (filter by category / vertical). USER-gated.
//
export class GetCatalog extends RestfulEndpoint< GetCatalog.Query, undefined, GetCatalog.Response >
{
    public readonly uri      : string = GetCatalog.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listMarketplaceCatalog",
        summary:     "Browse the integration catalog",
        description: "Lists integration definitions (paged), optionally filtered by category/vertical.",
        tags:        [ "Marketplace" ],
    };

    constructor( query? : GetCatalog.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCatalog
{
    export const URI : string = apiPath( "marketplace", 1, "/catalog" );

    export interface Query extends Paging.Request
    {
        category? : Marketplace.Category;
        vertical?  : Marketplace.Vertical;
    }

    export interface Response extends Paging.Result<Marketplace.IntegrationDefinition> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetCatalog;
