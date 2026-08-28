//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Installation detail (config, status, health, acceptance). USER-gated.
//
export class GetInstallation extends RestfulEndpoint< GetInstallation.Query, undefined, GetInstallation.Response >
{
    public readonly uri      : string = GetInstallation.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMarketplaceInstallation",
        summary:     "Get an installation",
        description: "Fetches one installation's config/status/health/acceptance.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInstallation
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Marketplace.Installation {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInstallation;
