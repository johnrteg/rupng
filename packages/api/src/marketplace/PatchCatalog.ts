//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Edit a catalog definition (visibility, paywall, capabilities, …). APPLICATION-gated.
//
export class PatchCatalog extends RestfulEndpoint< PatchCatalog.Query, PatchCatalog.Body, PatchCatalog.Response >
{
    public readonly uri      : string = PatchCatalog.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateMarketplaceCatalogItem",
        summary:     "Edit a catalog definition",
        description: "Updates a platform-global integration definition.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such integration in the catalog" },
    };

    constructor( integrationId? : string, body? : PatchCatalog.Body ) { super( { integrationId: integrationId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "integrationId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PatchCatalog
{
    export const URI : string = apiPath( "marketplace", 1, "/catalog/:integrationId" );

    export interface Query { integrationId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest, Partial<Marketplace.IntegrationDefinition> {}
    export interface Response extends Marketplace.IntegrationDefinition {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchCatalog;
