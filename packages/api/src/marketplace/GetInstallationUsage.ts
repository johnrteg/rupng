//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Per-instance usage counters, one row per period (marketplace-8.1). USER-gated.
//
export class GetInstallationUsage extends RestfulEndpoint< GetInstallationUsage.Query, undefined, GetInstallationUsage.Response >
{
    public readonly uri      : string = GetInstallationUsage.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMarketplaceInstallationUsage",
        summary:     "Get an installation's usage",
        description: "Lists per-period usage counters for one installation.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInstallationUsage
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id/usage" );

    export interface Query { id : Type.UUID; }
    export interface Response { meters : Array<Marketplace.UsageMeter>; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInstallationUsage;
