//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AuditConfig } from "./model/AuditConfig";

//
// Read the audit service's runtime config — retention tiers + tamper-evidence toggle (audit-4.1).
// ROOT — platform operator surface.
//
export class GetAuditConfig extends RestfulEndpoint< {}, undefined, GetAuditConfig.Response >
{
    public readonly uri      : string = GetAuditConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAuditConfig",
        summary:     "Get audit service config",
        description: "Reads the audit service's runtime configuration (retention tiers, tamper-evidence toggle).",
        tags:        [ "Audit" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAuditConfig
{
    export const URI : string = apiPath( "audit", 1, "/config" );
    export interface Response { config : AuditConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetAuditConfig;
// eof
