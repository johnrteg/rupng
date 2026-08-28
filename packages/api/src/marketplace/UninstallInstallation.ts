//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";

//
// Uninstall — purges the credential, revokes upstream where supported, tears down webhook
// subscriptions, marks the installation REMOVED (never hard-deleted). ACCOUNT-gated (a step-up action
// per SPECS.md's endpoint table — enforced the same as any other ACCOUNT-role action for now; a
// dedicated step-up/re-auth challenge is a later addition).
//
export class UninstallInstallation extends RestfulEndpoint< UninstallInstallation.Query, undefined, UninstallInstallation.Response >
{
    public readonly uri      : string = UninstallInstallation.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "uninstallMarketplaceInstallation",
        summary:     "Uninstall",
        description: "Purges the credential, revokes upstream, tears down webhooks, marks REMOVED.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace UninstallInstallation
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; removed : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default UninstallInstallation;
