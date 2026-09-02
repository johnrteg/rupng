//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AuditConfig } from "./model/AuditConfig";

//
// Set the audit service's runtime config (AppConfig-backed). ROOT. The body is the full
// AuditConfig.Config; the impl validates against AuditConfig.SCHEMA + persists to AppConfig.
//
export class PutAuditConfig extends RestfulEndpoint< {}, PutAuditConfig.Body, PutAuditConfig.Response >
{
    public readonly uri      : string = PutAuditConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setAuditConfig",
        summary:     "Set audit service config",
        description: "Replaces the audit service's runtime configuration (validated against the config schema).",
        tags:        [ "Audit" ],
    };

    constructor( body? : PutAuditConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict AuditConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutAuditConfig
{
    export const URI : string = apiPath( "audit", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : AuditConfig.Config; }
    export interface Response { config : AuditConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutAuditConfig;
// eof
