//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailConfig } from "./model/EmailConfig";

//
// Set the email service's runtime config (AppConfig-backed). ROOT. The body is the full EmailConfig.Config;
// the impl validates against EmailConfig.SCHEMA + persists to AppConfig (email-11.2).
//
export class PutEmailConfig extends RestfulEndpoint< {}, PutEmailConfig.Body, PutEmailConfig.Response >
{
    public readonly uri      : string = PutEmailConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setEmailConfig",
        summary:     "Set email service config",
        description: "Replaces the email service's runtime configuration (validated against the config schema).",
        tags:        [ "Email" ],
    };

    constructor( body? : PutEmailConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict EmailConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutEmailConfig
{
    export const URI : string = apiPath( "email", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : EmailConfig.Config; }
    export interface Response { config : EmailConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutEmailConfig;
// eof
