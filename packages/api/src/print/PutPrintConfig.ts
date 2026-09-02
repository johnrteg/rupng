//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PrintConfig } from "./model/PrintConfig";

//
// Write the print service's runtime config (ROOT) — the smart/JSON Console editor's save path; validated
// against `PrintConfig.SCHEMA` (see ConfigSchema.ts) before deploy.
//
export class PutPrintConfig extends RestfulEndpoint< {}, PutPrintConfig.Body, PutPrintConfig.Response >
{
    public readonly uri      : string = PutPrintConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setPrintConfig",
        summary:     "Set print service config",
        description: "Writes + deploys a new version of the print service's runtime configuration.",
        tags:        [ "Print" ],
    };

    constructor( body? : PutPrintConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PutPrintConfig
{
    export const URI : string = apiPath( "print", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest, PrintConfig.Config {}
    export interface Response { config : PrintConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutPrintConfig;
// eof
