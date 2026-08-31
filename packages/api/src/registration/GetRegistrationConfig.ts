//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { RegistrationConfig } from "./model/RegistrationConfig";

//
// Read the registration service's runtime config (AppConfig-backed — CSP identity, carrier-provider registry,
// use-case/vetting fee tables, line caps, poll-sweep cadence). ROOT — platform operator surface.
//
export class GetRegistrationConfig extends RestfulEndpoint< {}, undefined, GetRegistrationConfig.Response >
{
    public readonly uri      : string = GetRegistrationConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getRegistrationConfig",
        summary:     "Get registration service config",
        description: "Reads the registration service's runtime configuration (CSP identity, carrier-provider registry, fee tables, line caps, poll-sweep cadence).",
        tags:        [ "Registration" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationConfig
{
    export const URI : string = apiPath( "registration", 1, "/config" );
    export interface Response { config : RegistrationConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetRegistrationConfig;
// eof
