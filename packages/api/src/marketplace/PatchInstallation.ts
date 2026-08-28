//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Update an installation's config / label. ACCOUNT-gated.
//
export class PatchInstallation extends RestfulEndpoint< PatchInstallation.Query, PatchInstallation.Body, PatchInstallation.Response >
{
    public readonly uri      : string = PatchInstallation.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateMarketplaceInstallation",
        summary:     "Update an installation",
        description: "Updates an installation's config or label.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string, body? : PatchInstallation.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, properties: { config: { type: "object" }, label: { type: "string" } } }; }
}

export namespace PatchInstallation
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest { config? : Type.Json; label? : string; }
    export interface Response extends Marketplace.Installation {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchInstallation;
