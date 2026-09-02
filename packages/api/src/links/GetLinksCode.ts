//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Links } from "./model/Links";

//
// Read a code's metadata (target, targetType, status, attribution tuple) — links-1.1.
//
export class GetLinksCode extends RestfulEndpoint< GetLinksCode.Query, undefined, GetLinksCode.Response >
{
    public readonly uri      : string = GetLinksCode.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Links.READ_MIN_ACCESS;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getLinkCode",
        summary:     "Get a tracked link's metadata",
        description: "Returns the code's target, targetType, status, and attribution tuple.",
        tags:        [ "Links" ],
    };

    constructor( code? : string ) { super( { code: code ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "code", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetLinksCode
{
    export const URI : string = apiPath( "links", 1, "/:code" );
    export interface Query { code : string; }
    export interface Response extends Links.TrackedLink {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetLinksCode;
// eof
