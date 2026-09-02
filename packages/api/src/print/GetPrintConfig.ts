//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PrintConfig } from "./model/PrintConfig";

//
// Read the print service's runtime config (AppConfig-backed — default provider/verifier, mail class, NCOA
// window, limits). ROOT — platform operator surface.
//
export class GetPrintConfig extends RestfulEndpoint< {}, undefined, GetPrintConfig.Response >
{
    public readonly uri      : string = GetPrintConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getPrintConfig",
        summary:     "Get print service config",
        description: "Reads the print service's runtime configuration.",
        tags:        [ "Print" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintConfig
{
    export const URI : string = apiPath( "print", 1, "/config" );
    export interface Response { config : PrintConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetPrintConfig;
// eof
