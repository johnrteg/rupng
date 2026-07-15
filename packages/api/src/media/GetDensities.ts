//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// List the configured image DENSITY targets (media-4) — the DPI options a user can render an image to (e.g.
// Web 72, Print 300), sourced from the service's MediaConfig. The UI reads this to offer a density picker.
export class GetDensities extends RestfulEndpoint<{}, undefined, GetDensities.Response>
{
    public readonly uri      : string = GetDensities.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetDensities
{
    export const URI : string = apiPath( "media", 1, "/densities" );
    /** One selectable density target: its config `key`, display `label`, and `dpi`. */
    export interface Density { key : string; label : string; dpi : number; }
    export interface Response { densities : Array<Density>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetDensities;
