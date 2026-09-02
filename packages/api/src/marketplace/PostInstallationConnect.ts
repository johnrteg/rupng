//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Start (or restart) the connect flow — OAuth returns an authorize redirect URL; an API-key
// credential is validated + stored immediately. ACCOUNT-gated.
//
export class PostInstallationConnect extends RestfulEndpoint< PostInstallationConnect.Query, PostInstallationConnect.Body, PostInstallationConnect.Response >
{
    public readonly uri      : string = PostInstallationConnect.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "connectMarketplaceInstallation",
        summary:     "Start a connect flow",
        description: "Starts (or restarts) an installation's OAuth/API-key connect flow.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string, body? : PostInstallationConnect.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, properties: { apiKey: { type: "string" }, scopes: { type: "array" }, externalRef: { type: "string" } } }; }
}

export namespace PostInstallationConnect
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id/connect" );

    export interface Query { id : Type.UUID; }
    /** `externalRef` — the provider's OWN id for this connection (e.g. a Shopify shop domain), collected
     *  by the connect UI when the credential type needs one; persisted so inbound webhooks (which carry
     *  no installationId) can resolve their owning installation — see `Marketplace.Installation.externalRef`. */
    export interface Body extends RestfulEndpoint.AuthRequest { apiKey? : string; scopes? : Array<string>; externalRef? : string; }
    export interface Response extends Marketplace.ConnectResult {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInstallationConnect;
