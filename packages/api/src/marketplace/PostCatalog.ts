//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Create a catalog definition (platform-global). APPLICATION-gated (staff ladder) — the catalog is
// platform-managed, not account-editable.
//
export class PostCatalog extends RestfulEndpoint< {}, PostCatalog.Body, PostCatalog.Response >
{
    public readonly uri      : string = PostCatalog.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createMarketplaceCatalogItem",
        summary:     "Create a catalog definition",
        description: "Creates a platform-global integration definition.",
        tags:        [ "Marketplace" ],
    };

    constructor( body? : PostCatalog.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true, required: [ "integrationId", "name", "provider" ], properties: {
        integrationId: { type: "string" }, name: { type: "string" }, provider: { type: "string" } } }; }
}

export namespace PostCatalog
{
    export const URI : string = apiPath( "marketplace", 1, "/catalog" );

    export interface Body extends RestfulEndpoint.AuthRequest, Marketplace.IntegrationDefinition {}
    export interface Response extends Marketplace.IntegrationDefinition {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostCatalog;
