//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Trigger a health check now (validates the OAuth connection via the broker; a no-op for api_key/
// basic/webhook credential types, which the broker doesn't cover). ACCOUNT-gated.
//
export class PostInstallationHealthCheck extends RestfulEndpoint< PostInstallationHealthCheck.Query, undefined, PostInstallationHealthCheck.Response >
{
    public readonly uri      : string = PostInstallationHealthCheck.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "checkMarketplaceInstallationHealth",
        summary:     "Check installation health now",
        description: "Validates the connection now and updates stored health/status.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostInstallationHealthCheck
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id/health/check" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Marketplace.Health {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInstallationHealthCheck;
