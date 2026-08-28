//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Integration detail — definition fields, license/terms/privacy, paywall. USER-gated.
//
export class GetCatalogItem extends RestfulEndpoint< GetCatalogItem.Query, undefined, GetCatalogItem.Response >
{
    public readonly uri      : string = GetCatalogItem.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMarketplaceCatalogItem",
        summary:     "Get an integration's catalog detail",
        description: "Fetches one integration definition by id.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such integration in the catalog" },
    };

    constructor( integrationId? : string ) { super( { integrationId: integrationId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "integrationId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCatalogItem
{
    export const URI : string = apiPath( "marketplace", 1, "/catalog/:integrationId" );

    export interface Query { integrationId : string; }
    export interface Response extends Marketplace.IntegrationDefinition {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetCatalogItem;
