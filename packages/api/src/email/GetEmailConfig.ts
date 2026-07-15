//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailConfig } from "./model/EmailConfig";

//
// Read the email service's runtime config (AppConfig-backed — default/system provider, per-account limits,
// provider registry). ROOT — platform operator surface (email-11.2).
//
export class GetEmailConfig extends RestfulEndpoint< {}, undefined, GetEmailConfig.Response >
{
    public readonly uri      : string = GetEmailConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getEmailConfig",
        summary:     "Get email service config",
        description: "Reads the email service's runtime configuration (default/system provider, per-account send limits, provider registry).",
        tags:        [ "Email" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetEmailConfig
{
    export const URI : string = apiPath( "email", 1, "/config" );
    export interface Response { config : EmailConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetEmailConfig;
// eof
