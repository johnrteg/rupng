//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialConfig } from "./model/SocialConfig";

//
// Read the social service's runtime config (poll cadence, refresh cooldown, approvals default,
// per-network quota). ROOT — platform operator surface.
//
export class GetSocialConfig extends RestfulEndpoint< {}, undefined, GetSocialConfig.Response >
{
    public readonly uri      : string = GetSocialConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSocialConfig",
        summary:     "Get social service config",
        description: "Reads the social service's runtime configuration.",
        tags:        [ "Social" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSocialConfig
{
    export const URI : string = apiPath( "social", 1, "/config" );
    export interface Response { config : SocialConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetSocialConfig;
// eof
