//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Resume a paused installation. ACCOUNT-gated.
//
export class PostInstallationResume extends RestfulEndpoint< PostInstallationResume.Query, undefined, PostInstallationResume.Response >
{
    public readonly uri      : string = PostInstallationResume.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resumeMarketplaceInstallation",
        summary:     "Resume a paused installation",
        description: "Resumes a previously paused installation.",
        tags:        [ "Marketplace" ],
        errors:      { 404: "No such installation in this account", 409: "Installation isn't paused" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostInstallationResume
{
    export const URI : string = apiPath( "marketplace", 1, "/installations/:id/resume" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Marketplace.Installation {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInstallationResume;
