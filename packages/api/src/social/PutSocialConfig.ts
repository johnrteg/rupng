//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialConfig } from "./model/SocialConfig";

//
// Set the social service's runtime config (AppConfig-backed). ROOT. The body is the full
// SocialConfig.Config; the impl validates against SocialConfig.SCHEMA + persists to AppConfig.
//
export class PutSocialConfig extends RestfulEndpoint< {}, PutSocialConfig.Body, PutSocialConfig.Response >
{
    public readonly uri      : string = PutSocialConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setSocialConfig",
        summary:     "Set social service config",
        description: "Replaces the social service's runtime configuration (validated against the config schema).",
        tags:        [ "Social" ],
    };

    constructor( body? : PutSocialConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict SocialConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutSocialConfig
{
    export const URI : string = apiPath( "social", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : SocialConfig.Config; }
    export interface Response { config : SocialConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutSocialConfig;
// eof
