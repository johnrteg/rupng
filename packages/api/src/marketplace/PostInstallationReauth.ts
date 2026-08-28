//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Re-trigger OAuth when an installation's health is `needs-reauth`. ACCOUNT-gated.
//
export class PostInstallationReauth extends RestfulEndpoint< PostInstallationReauth.Query, undefined, PostInstallationReauth.Response >
{
    public readonly uri      : string = PostInstallationReauth.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "reauthMarketplaceInstallation",
        summary:     "Re-trigger OAuth",
        description: "Re-triggers OAuth for an installation whose health is needs-reauth.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostInstallationReauth
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id/reauth" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Marketplace.ConnectResult {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInstallationReauth;
