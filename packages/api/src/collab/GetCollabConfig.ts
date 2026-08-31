//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { CollabConfig } from "./model/CollabConfig";

//
// Read the collab service's runtime config (AppConfig-backed — message retention, log level). ROOT.
//
export class GetCollabConfig extends RestfulEndpoint< {}, undefined, GetCollabConfig.Response >
{
    public readonly uri      : string = GetCollabConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getCollabConfig",
        summary:     "Get collab service config",
        description: "Reads the collab service's runtime configuration (message retention, log level).",
        tags:        [ "Collab" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCollabConfig
{
    export const URI : string = apiPath( "collab", 1, "/config" );
    export interface Response { config : CollabConfig.Config; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetCollabConfig;
// eof
