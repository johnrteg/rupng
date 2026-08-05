//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgAsset } from "./model/SvgAsset";

// List available SVG library graphics — system (platform, read-only) + the requesting account's own.
// Returns summaries only (no markup body) so the picker grid stays light.
export class GetSvgAssets extends RestfulEndpoint<{}, undefined, GetSvgAssets.Response>
{
    public readonly uri      : string = GetSvgAssets.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSvgAssets
{
    export const URI : string = apiPath( "media", 1, "/svg/assets" );
    export interface Response { assets : Array<SvgAsset.Summary>; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetSvgAssets;
