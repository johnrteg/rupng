//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { RegistrationConfig } from "./model/RegistrationConfig";

//
// Set the registration service's runtime config (AppConfig-backed). ROOT. The body is the full
// RegistrationConfig.Config; the impl validates against RegistrationConfig.SCHEMA + persists to AppConfig.
//
export class PutRegistrationConfig extends RestfulEndpoint< {}, PutRegistrationConfig.Body, PutRegistrationConfig.Response >
{
    public readonly uri      : string = PutRegistrationConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setRegistrationConfig",
        summary:     "Set registration service config",
        description: "Replaces the registration service's runtime configuration (validated against the config schema).",
        tags:        [ "Registration" ],
    };

    constructor( body? : PutRegistrationConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict RegistrationConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutRegistrationConfig
{
    export const URI : string = apiPath( "registration", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : RegistrationConfig.Config; }
    export interface Response { config : RegistrationConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutRegistrationConfig;
// eof
